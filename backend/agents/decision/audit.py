"""Audit persistence for the Decision + Report agents.

Reads use mcp-clickhouse (Layer 3a boundary rule).
Writes use clickhouse-connect (BUILD-RISK-FALLBACK per Task 2).

Schema: decision_audit is ReplacingMergeTree(updated_at) — creation and
approve/deny both INSERT a new row with the same decision_id; SELECT ...
FINAL returns the latest version.
"""

# BUILD-RISK-FALLBACK ACTIVE: Task 2 confirmed MCP writes are blocked;
# audit INSERTs use clickhouse-connect (see _run_write). Reads still use MCP.

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic import BaseModel

from agents.decision.contracts import (
    ApprovalStatus, DecisionResult, RecommendedAction,
)
from agents.investigation.contracts import InvestigationResult
from mcp_integration.client import build_toolset


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


async def _run_read(sql: str) -> list[list[Any]]:
    """Fire a single SELECT through mcp-clickhouse and return the rows."""
    agent = LlmAgent(
        name="audit_reader",
        model="gemini-2.5-flash",
        instruction=(
            "Call run_query with EXACTLY this SQL and return ONLY the raw "
            "JSON result the tool gives back:\n\n" + sql
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="audit_reader")
    session = await runner.session_service.create_session(
        app_name="audit_reader", user_id="audit"
    )
    rows: list[list[Any]] = []
    async for event in runner.run_async(
        user_id="audit",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    rows = _extract_rows(part.function_response.response) or rows
    return rows


def _extract_rows(resp: Any) -> list[list[Any]]:
    """mcp-clickhouse returns {'structuredContent':{'result':<json-str>}, ...}
    where the json-str parses to {'columns':[...], 'rows':[[...]]}."""
    if isinstance(resp, dict):
        sc = resp.get("structuredContent")
        if isinstance(sc, dict) and isinstance(sc.get("result"), str):
            try:
                parsed = json.loads(sc["result"])
                if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                    return parsed["rows"]
            except json.JSONDecodeError:
                pass
        content = resp.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    txt = item.get("text")
                    if isinstance(txt, str):
                        try:
                            parsed = json.loads(txt)
                            if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                                return parsed["rows"]
                        except json.JSONDecodeError:
                            pass
    return []


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
        "toString(approved_at), toString(created_at), toString(updated_at) "
        "FROM decision_audit FINAL "
        f"ORDER BY updated_at DESC LIMIT {int(limit)}"
    )
    rows = asyncio.run(_run_read(sql))
    return [_row_to_audit(r) for r in rows]


def get_audit(decision_id: str) -> AuditRow | None:
    sql = (
        "SELECT decision_id, investigation_id, detection_dedup_key, film_id, "
        "region, actions_json, status, threshold_usd, agent_run_json, "
        "report_json, approval_status, approver, approval_note, "
        "toString(approved_at), toString(created_at), toString(updated_at) "
        "FROM decision_audit FINAL "
        f"WHERE decision_id = '{_sql_escape(decision_id)}' LIMIT 1"
    )
    rows = asyncio.run(_run_read(sql))
    if not rows:
        return None
    return _row_to_audit(rows[0])


# ---------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------

def _insert_row(row: AuditRow) -> None:
    actions_json = _sql_escape(json.dumps([a.model_dump(mode="json") for a in row.actions]))
    agent_run_json = _sql_escape(row.agent_run.model_dump_json())
    report_json = ""
    if row.report is not None:
        report_json = _sql_escape(row.report.model_dump_json())
    approved_at_sql = (
        "NULL" if row.approved_at is None
        else f"toDateTime('{row.approved_at.strftime('%Y-%m-%d %H:%M:%S')}')"
    )
    sql = (
        "INSERT INTO decision_audit "
        "(decision_id, investigation_id, detection_dedup_key, film_id, region, "
        " actions_json, status, threshold_usd, agent_run_json, report_json, "
        " approval_status, approver, approval_note, approved_at, "
        " created_at, updated_at) VALUES "
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
        f" '{_sql_escape(row.approval_status)}',"
        f" '{_sql_escape(row.approver)}',"
        f" '{_sql_escape(row.approval_note)}',"
        f" {approved_at_sql},"
        f" toDateTime('{row.created_at.strftime('%Y-%m-%d %H:%M:%S')}'),"
        f" toDateTime('{row.updated_at.strftime('%Y-%m-%d %H:%M:%S')}'))"
    )
    asyncio.run(_run_write(sql))


def _row_to_audit(cols: list[Any]) -> AuditRow:
    (
        decision_id, investigation_id, detection_dedup_key, film_id, region,
        actions_json, status, threshold_usd, agent_run_json, report_json,
        approval_status, approver, approval_note,
        approved_at_str, created_at_str, updated_at_str,
    ) = cols
    ReportCls = _report_model_class()
    if report_json and ReportCls is not None:
        report = ReportCls.model_validate_json(report_json)
    elif report_json:
        # agents.report.contracts not yet implemented; return raw dict
        report = json.loads(report_json)
    else:
        report = None
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
