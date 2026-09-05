"""Audit persistence for the Decision + Report agents.

Reads and writes both go through clickhouse-connect (BUILD-RISK-FALLBACK
per Task 2 for writes; extended to reads because the LLM+MCP read path
was 5-10s per SELECT and produced Vertex 499 cascades under acceptance
load). audit.py is the single §1 exception for both directions.

Schema: decision_audit is ReplacingMergeTree(updated_at) — creation and
approve/deny both INSERT a new row with the same decision_id; SELECT ...
FINAL returns the latest version.
"""

# BUILD-RISK-FALLBACK ACTIVE: audit reads and writes both use clickhouse-connect.

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel

from agents.decision.contracts import (
    ApprovalStatus, DecisionResult, RecommendedAction,
)
from agents.investigation.contracts import InvestigationResult


# Report is imported lazily to avoid a circular import between
# agents.decision (which references it in AuditRow) and agents.report.
def _report_model_class() -> type[BaseModel] | None:
    try:
        from agents.report.contracts import ExecutiveReport
        return ExecutiveReport
    except ModuleNotFoundError:
        # agents.report.contracts is implemented in a later task; until then,
        # report_json is stored and read back as raw JSON (dict via Any field).
        return None


class AuditRow(BaseModel):
    """One versioned row from decision_audit (FINAL-resolved)."""

    decision_id: str
    investigation_id: str
    detection_dedup_key: str
    film_id: int
    region: str
    actions: list[RecommendedAction]
    status: ApprovalStatus
    threshold_usd: float
    agent_run: DecisionResult
    report: Any = None                       # ExecutiveReport | None (lazy)
    # Full InvestigationResult (findings + hypothesis) persisted so
    # past-run replays and backfilled rows can render the Investigation
    # panel with real narratives instead of an empty stub. Stored in
    # decision_audit.investigation_json (see audit_schema.sql).
    investigation: InvestigationResult | None = None
    approval_status: ApprovalStatus
    approver: str = ""
    approval_note: str = ""
    approved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------
# Write helper — clickhouse-connect fallback (Task 2 blocked MCP writes)
# ---------------------------------------------------------------------

async def _run_write(sql: str) -> None:
    """Fire a single SQL statement via clickhouse-connect.

    BUILD-RISK-FALLBACK: MCP writes blocked (Task 2). Uses clickhouse-connect.
    Kept async for API symmetry with _run_read; body is sync.
    """
    from data.ch_client import client
    with client() as c:
        c.command(sql)


def run_impact_sql(sql: str) -> float | None:
    """Execute an impact SQL directly via clickhouse-connect and return the first cell.

    BUILD-RISK-FALLBACK: The MCP-mediated impact execution in agent.py is too slow
    (15-20s per query due to LLM schema discovery). Impact SQLs are rendered from
    canonical TEMPLATES with validated params (see actions.py INJECTION-DEFENSE note),
    so direct execution is safe.

    Returns:
      - float (possibly 0.0) on success, including when ClickHouse returns NULL
        or NaN (both mean "empty rollup / arithmetic on missing data" = 0 impact,
        not a failure).
      - None only when the query returns 0 rows (structural failure).

    NaN handling matters: json.dumps(float('nan')) is allowed by Python but
    not valid JSON, and FastAPI's default encoder ends up producing invalid
    payloads that kill the SSE stream mid-decision. Same reasoning for +/-inf.
    """
    from math import isfinite

    from data.ch_client import client
    with client() as c:
        rows = c.query(sql).result_rows
    if not rows or not rows[0]:
        return None
    val = rows[0][0]
    # NULL from ClickHouse (e.g. avg() of empty set * anything) means the
    # rollup has no data — treat as 0.0 impact rather than failure.
    if val is None:
        return 0.0
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    # NaN / +inf / -inf come from division-by-zero on empty rollups (avg over
    # all-NULL, or 0/0 masked to NULL then combined with 0 counts). Coerce to
    # 0.0 so downstream JSON encoding and threshold comparisons behave.
    if not isfinite(f):
        return 0.0
    return f


async def _run_read(sql: str) -> list[list[Any]]:
    """Fire a single SELECT via clickhouse-connect (BUILD-RISK-FALLBACK).

    Original LLM+MCP path cost 5-10s per read (Gemini schema discovery)
    and produced Vertex 499 CANCELLED cascades when acceptance ran audit
    reads back-to-back. audit.py was already §1-exempt for _run_write —
    extending the fallback to reads is symmetry, not a new exception.

    Kept async signature so callers (async_get_audit etc.) don't need to
    change; body is synchronous clickhouse-connect (single-cell reads,
    <100ms, blocking is fine).
    """
    from data.ch_client import client
    with client() as c:
        return [list(row) for row in c.query(sql).result_rows]


def _sql_escape(s: str) -> str:
    """Escape a string for interpolation into a ClickHouse single-quoted literal."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


# ---------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------

def audit_insert(decision: DecisionResult, inv: InvestigationResult) -> AuditRow:
    """Insert the initial audit row for a freshly-created decision.

    approval_status is derived from decision.status:
      - auto_executed  -> approval_status='auto_executed'   (no human needed)
      - pending_approval -> approval_status='pending_approval'

    Persists the full InvestigationResult (findings + hypothesis) alongside
    the decision so past-run replays and backfilled rows can render the
    Investigation panel with real narratives.
    """
    now = datetime.now(timezone.utc)
    approval_status: ApprovalStatus = (
        "auto_executed" if decision.status == "auto_executed" else "pending_approval"
    )
    row = AuditRow(
        decision_id=decision.decision_id,
        investigation_id=decision.investigation_id,
        detection_dedup_key=inv.detection.dedup_key,
        film_id=inv.detection.film_id,
        region=inv.detection.region,
        actions=list(decision.actions),
        status=decision.status,
        threshold_usd=decision.threshold_usd,
        agent_run=decision,
        report=None,
        investigation=inv,
        approval_status=approval_status,
        approver="",
        approval_note="",
        approved_at=None,
        created_at=now,
        updated_at=now,
    )
    _insert_row(row)
    return row


def audit_attach_report(decision_id: str, report: BaseModel) -> AuditRow:
    """Version-bump the audit row to include the emitted ExecutiveReport."""
    current = get_audit(decision_id)
    if current is None:
        raise ValueError(f"no audit row for decision_id={decision_id!r}")
    current.report = report
    current.updated_at = datetime.now(timezone.utc)
    _insert_row(current)
    return current


async def async_audit_attach_report(decision_id: str, report: BaseModel) -> AuditRow:
    """Async version of audit_attach_report — use from async contexts."""
    current = await async_get_audit(decision_id)
    if current is None:
        raise ValueError(f"no audit row for decision_id={decision_id!r}")
    current.report = report
    current.updated_at = datetime.now(timezone.utc)
    _insert_row(current)
    return current


def approve_decision(decision_id: str, approver: str, note: str = "") -> AuditRow:
    return _set_approval(decision_id, approver, note, "approved")


def deny_decision(decision_id: str, approver: str, note: str = "") -> AuditRow:
    return _set_approval(decision_id, approver, note, "denied")


def _set_approval(
    decision_id: str, approver: str, note: str, status: ApprovalStatus,
) -> AuditRow:
    current = get_audit(decision_id)
    if current is None:
        raise ValueError(f"no audit row for decision_id={decision_id!r}")
    now = datetime.now(timezone.utc)
    current.approval_status = status
    current.approver = approver
    current.approval_note = note
    current.approved_at = now
    current.updated_at = now
    _insert_row(current)
    return current


def list_recent_audit(limit: int = 50) -> list[AuditRow]:
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at), "
        "investigation_json "
        "FROM decision_audit FINAL "
        f"ORDER BY updated_at DESC LIMIT {int(limit)}"
    )
    rows = asyncio.run(_run_read(sql))
    return [_row_to_audit(r) for r in rows]


def list_recent_audit_for_film(film_id: int, limit: int = 10) -> list[AuditRow]:
    """Newest completed runs for a specific film, most recent first."""
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at), "
        "investigation_json "
        "FROM decision_audit FINAL "
        f"WHERE film_id = {int(film_id)} "
        f"ORDER BY updated_at DESC LIMIT {int(limit)}"
    )
    rows = asyncio.run(_run_read(sql))
    return [_row_to_audit(r) for r in rows]


def list_recent_audit_for_film_region(
    film_id: int, region: str, limit: int = 10,
) -> list[AuditRow]:
    """Newest completed runs for a specific (film, region), most recent first.
    Same shape as list_recent_audit_for_film but scoped to one region so the
    Dashboard's Investigation panel can retarget when the user picks a region.
    """
    safe_region = _sql_escape(region)
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at), "
        "investigation_json "
        "FROM decision_audit FINAL "
        f"WHERE film_id = {int(film_id)} AND region = '{safe_region}' "
        f"ORDER BY updated_at DESC LIMIT {int(limit)}"
    )
    rows = asyncio.run(_run_read(sql))
    return [_row_to_audit(r) for r in rows]


def get_audit(decision_id: str) -> AuditRow | None:
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at), "
        "investigation_json "
        "FROM decision_audit FINAL "
        f"WHERE decision_id = '{_sql_escape(decision_id)}' LIMIT 1"
    )
    rows = asyncio.run(_run_read(sql))
    if not rows:
        return None
    return _row_to_audit(rows[0])


async def async_get_audit(decision_id: str) -> AuditRow | None:
    """Async version of get_audit — use from async contexts to avoid nested loops."""
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at), "
        "investigation_json "
        "FROM decision_audit FINAL "
        f"WHERE decision_id = '{_sql_escape(decision_id)}' LIMIT 1"
    )
    rows = await _run_read(sql)
    if not rows:
        return None
    return _row_to_audit(rows[0])


async def async_approve_decision(
    decision_id: str, approver: str, note: str = "",
) -> AuditRow:
    """Async version of approve_decision — use from async contexts."""
    return await _async_set_approval(decision_id, approver, note, "approved")


async def _async_set_approval(
    decision_id: str, approver: str, note: str, status: ApprovalStatus,
) -> AuditRow:
    current = await async_get_audit(decision_id)
    if current is None:
        raise ValueError(f"no audit row for decision_id={decision_id!r}")
    now = datetime.now(timezone.utc)
    current.approval_status = status
    current.approver = approver
    current.approval_note = note
    current.approved_at = now
    current.updated_at = now
    _insert_row(current)
    return current


# ---------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------

def _insert_row(row: AuditRow) -> None:
    actions_json = _sql_escape(json.dumps([a.model_dump(mode="json") for a in row.actions]))
    agent_run_json = _sql_escape(row.agent_run.model_dump_json())
    report_json = ""
    if row.report is not None:
        report_json = _sql_escape(row.report.model_dump_json())
    investigation_json = ""
    if row.investigation is not None:
        investigation_json = _sql_escape(row.investigation.model_dump_json())
    approved_at_sql = (
        "NULL" if row.approved_at is None
        else f"toDateTime('{row.approved_at.strftime('%Y-%m-%d %H:%M:%S')}')"
    )
    sql = (
        "INSERT INTO decision_audit "
        "(decision_id, investigation_id, detection_dedup_key, film_id, region, "
        " actions_json, status, threshold_usd, agent_run_json, report_json, "
        " investigation_json, approval_status, approver, approval_note, "
        " approved_at, created_at, updated_at) VALUES "
        f"('{_sql_escape(row.decision_id)}',"
        f" '{_sql_escape(row.investigation_id)}',"
        f" '{_sql_escape(row.detection_dedup_key)}',"
        f" {int(row.film_id)},"
        f" '{_sql_escape(row.region)}',"
        f" '{actions_json}',"
        f" '{_sql_escape(row.status)}',"
        f" {float(row.threshold_usd)},"
        f" '{agent_run_json}',"
        f" '{report_json}',"
        f" '{investigation_json}',"
        f" '{_sql_escape(row.approval_status)}',"
        f" '{_sql_escape(row.approver)}',"
        f" '{_sql_escape(row.approval_note)}',"
        f" {approved_at_sql},"
        f" toDateTime('{row.created_at.strftime('%Y-%m-%d %H:%M:%S')}'),"
        f" toDateTime('{row.updated_at.strftime('%Y-%m-%d %H:%M:%S')}'))"
    )
    # _run_write body is synchronous (ch_client.command); call it directly to
    # avoid asyncio.run() failing when already inside a running event loop
    # (e.g. when invoked from within an async pipeline like invoke_decision).
    from data.ch_client import client
    with client() as c:
        c.command(sql)


def _row_to_audit(cols: list[Any]) -> AuditRow:
    (
        decision_id, investigation_id, detection_dedup_key, film_id, region,
        actions_json, status, threshold_usd, agent_run_json, report_json,
        approval_status, approver, approval_note,
        approved_at_str, created_at_str, updated_at_str,
        # investigation_json is appended at the tail of every SELECT so old
        # readers that don't ask for it still work. Callers that use the newer
        # column list will pass a 17th element.
        *rest,
    ) = cols
    investigation_json = rest[0] if rest else ""
    ReportCls = _report_model_class()
    if report_json and ReportCls is not None:
        report = ReportCls.model_validate_json(report_json)
    elif report_json:
        # agents.report.contracts not yet implemented; return raw dict
        report = json.loads(report_json)
    else:
        report = None
    investigation: InvestigationResult | None = None
    if investigation_json:
        try:
            investigation = InvestigationResult.model_validate_json(investigation_json)
        except Exception:  # noqa: BLE001
            # Old rows may have empty or malformed payloads; degrade gracefully.
            investigation = None
    return AuditRow(
        decision_id=decision_id,
        investigation_id=investigation_id,
        detection_dedup_key=detection_dedup_key,
        film_id=int(film_id),
        region=region,
        actions=[RecommendedAction.model_validate(a) for a in json.loads(actions_json)],
        status=status,
        threshold_usd=float(threshold_usd),
        agent_run=DecisionResult.model_validate_json(agent_run_json),
        report=report,
        investigation=investigation,
        approval_status=approval_status,
        approver=approver,
        approval_note=approval_note,
        approved_at=_parse_ch_dt(approved_at_str),
        created_at=_parse_ch_dt(created_at_str) or datetime.now(timezone.utc),
        updated_at=_parse_ch_dt(updated_at_str) or datetime.now(timezone.utc),
    )


def _parse_ch_dt(s: str | None) -> datetime | None:
    if not s or s in ("1970-01-01 00:00:00", "None"):
        return None
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
