"""Layer 3b acceptance sweep — 9 checks. Exit 0 if all pass, 1 otherwise.

  §1 boundary grep    §2 fixtures load     §3 taxonomy compliance
  §4 impact provenance §5 status logic     §6 audit persisted
  §7 report provenance §8 latency (fixture) §9 live end-to-end smoke

§9 costs ~$0.15 (one Layer 3a + one Layer 3b run). Fixture-only checks
(§3-§8) cost ~$0.05 across the 3 fixtures. Total ~$0.20/run.
"""

from __future__ import annotations

import asyncio
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

from agents.decision.acceptance_helpers import (
    load_one_crisis_detection,
    reload_impact,
)
from agents.decision.actions import (
    ACTION_TYPES, DEFAULT_THRESHOLDS_USD, compute_status, validate_params,
)
from agents.decision.agent import invoke_decision
from agents.decision.audit import (
    approve_decision, async_approve_decision, async_get_audit,
    audit_attach_report, get_audit,
)
from agents.decision.contracts import DecisionResult
from agents.investigation.agent import invoke_investigation
from agents.investigation.contracts import InvestigationResult
from agents.report._provenance import validate_report_provenance
from agents.report.agent import invoke_report


FIXTURE_DIR = Path(__file__).parent / "tests" / "fixtures"
MEAN_LATENCY_TARGET_SECONDS = 25.0
MAX_LATENCY_TARGET_SECONDS = 40.0
IMPACT_DRIFT_TOLERANCE = 0.05
LIVE_TOTAL_LATENCY_CAP = 180.0


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------
# §1 — Boundary grep
# ---------------------------------------------------------------------
def check_1_boundary_grep() -> None:
    r = subprocess.run(
        ["grep", "-rEln",
         r"(from data\.ch_client|import clickhouse_connect)",
         "backend/agents/decision/", "backend/agents/report/",
         "--include=*.py",
         "--exclude-dir=venv", "--exclude-dir=__pycache__"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n") if p]
    # audit.py is an explicit fallback exception (spec §6.4).
    # regenerate_fixtures.py uses ch_client to seed fixture data (BUILD-RISK-FALLBACK).
    # acceptance.py contains the grep pattern string itself (false positive).
    FALLBACK_EXCEPTIONS = {"/audit.py", "/regenerate_fixtures.py", "/acceptance.py"}
    bad = [p for p in bad if not any(p.endswith(exc) for exc in FALLBACK_EXCEPTIONS)]
    if bad:
        _fail(f"boundary violation — {bad}")
    print("PASS §1: no direct ClickHouse client imports in decision/report "
          "(audit.py fallback exempt per spec §6.4)")


# ---------------------------------------------------------------------
# §2 — Fixtures load & validate
# ---------------------------------------------------------------------
def check_2_fixtures_load() -> list[InvestigationResult]:
    paths = sorted(FIXTURE_DIR.glob("inv_*.json"))
    if len(paths) < 3:
        _fail(f"§2 need >=3 fixtures under {FIXTURE_DIR}, found {len(paths)}. "
              f"Run agents.decision.tests.fixtures.regenerate_fixtures.")
    invs: list[InvestigationResult] = []
    for p in paths:
        try:
            invs.append(InvestigationResult.model_validate_json(p.read_text()))
        except Exception as e:
            _fail(f"§2 fixture {p.name} failed to validate: {e}")
    print(f"PASS §2: {len(invs)} fixtures load & validate against Layer 3a schema")
    return invs


# ---------------------------------------------------------------------
# §3-§8 driven together (share the decision+report runs)
# ---------------------------------------------------------------------
async def check_3_to_8(invs: list[InvestigationResult]) -> None:
    latencies: list[float] = []
    for i, inv in enumerate(invs, 1):
        # ---- §3 + latency + §5 (via invoke_decision) ----
        t0 = time.perf_counter()
        try:
            dec = await invoke_decision(inv)
        except Exception as e:
            _fail(f"§3 fixture {i}: invoke_decision raised: {type(e).__name__}: {e}")
        decision_dt = time.perf_counter() - t0

        # §3: taxonomy compliance + params match spec.
        if not (1 <= len(dec.actions) <= 3):
            _fail(f"§3 fixture {i}: {len(dec.actions)} actions, expected 1-3")
        for j, a in enumerate(dec.actions):
            if a.action_type not in ACTION_TYPES:
                _fail(f"§3 fixture {i} action[{j}]: unknown type {a.action_type!r}")
            try:
                validate_params(a.action_type, a.params)
            except ValueError as e:
                _fail(f"§3 fixture {i} action[{j}] ({a.action_type}): {e}")

        # §4: impact provenance — re-run each impact_sql via MCP and verify
        # value matches within tolerance. Skips escalate_to_human (SELECT 0).
        for j, a in enumerate(dec.actions):
            if a.impact_usd is None:
                continue  # Recorded impact_error is acceptable (checked in §5).
            if not a.impact_sql:
                _fail(f"§4 fixture {i} action[{j}]: impact_usd set but "
                      f"impact_sql empty — provenance broken")
            reloaded = await reload_impact(a.impact_sql)
            if reloaded is None:
                # SQL succeeded once (impact_usd set), can't reload now — flag.
                _fail(f"§4 fixture {i} action[{j}]: re-run returned no rows")
            drift = abs(reloaded - a.impact_usd) / max(abs(a.impact_usd), 1.0)
            if drift > IMPACT_DRIFT_TOLERANCE:
                _fail(f"§4 fixture {i} action[{j}] ({a.action_type}): "
                      f"impact drift {drift:.2%} > {IMPACT_DRIFT_TOLERANCE:.0%} "
                      f"(stored={a.impact_usd}, reloaded={reloaded})")

        # §5: status logic — recompute from actions and verify agent output matches.
        expected_status, _ = compute_status(list(dec.actions))
        if dec.status != expected_status:
            _fail(f"§5 fixture {i}: status={dec.status!r}, "
                  f"deterministic compute_status says {expected_status!r}")
        if any(a.action_type == "escalate_to_human" for a in dec.actions):
            if dec.status != "pending_approval":
                _fail(f"§5 fixture {i}: escalate action present but status "
                      f"is {dec.status!r} (must be pending_approval)")

        # §6: audit persisted — get_audit returns the row; approve mutates status.
        row = await async_get_audit(dec.decision_id)
        if row is None:
            _fail(f"§6 fixture {i}: no audit row for decision_id={dec.decision_id}")
        if row.approval_status not in ("pending_approval", "auto_executed"):
            _fail(f"§6 fixture {i}: initial approval_status is "
                  f"{row.approval_status!r}, expected pending_approval or auto_executed")

        # ---- §7 + latency (via invoke_report) ----
        t1 = time.perf_counter()
        try:
            report = await invoke_report(inv, dec)
        except Exception as e:
            _fail(f"§7 fixture {i}: invoke_report raised: {type(e).__name__}: {e}")
        report_dt = time.perf_counter() - t1

        ok, violations = validate_report_provenance(report, inv, dec)
        if not ok:
            _fail(f"§7 fixture {i}: provenance failed: {violations}")

        # §6 continuation: approve and re-read; verify version bump.
        original_updated = row.updated_at
        approved = await async_approve_decision(dec.decision_id, "acceptance@example", "auto-approved for test")
        if approved.approval_status != "approved":
            _fail(f"§6 fixture {i}: approve_decision left status={approved.approval_status!r}")
        if approved.updated_at <= original_updated:
            _fail(f"§6 fixture {i}: updated_at did not advance after approve")

        latencies.append(decision_dt + report_dt)

    # §8: latency budget
    mean = statistics.mean(latencies)
    mx = max(latencies)
    if mean > MEAN_LATENCY_TARGET_SECONDS:
        _fail(f"§8 mean fixture latency {mean:.1f}s > {MEAN_LATENCY_TARGET_SECONDS:.0f}s")
    if mx > MAX_LATENCY_TARGET_SECONDS:
        _fail(f"§8 max fixture latency {mx:.1f}s > {MAX_LATENCY_TARGET_SECONDS:.0f}s")

    print("PASS §3: action taxonomy + param spec compliance across all fixtures")
    print("PASS §4: impact_usd re-execution within tolerance for all populated actions")
    print("PASS §5: status logic matches deterministic compute_status")
    print("PASS §6: audit rows persisted; approve flips status and bumps updated_at")
    print("PASS §7: report provenance validates for every KeyFigure")
    print(f"PASS §8: latency mean={mean:.1f}s max={mx:.1f}s "
          f"(targets <{MEAN_LATENCY_TARGET_SECONDS:.0f}s mean, "
          f"<{MAX_LATENCY_TARGET_SECONDS:.0f}s max)")


# ---------------------------------------------------------------------
# §9 — Live end-to-end smoke: 3a → 3b for one fresh crisis
# ---------------------------------------------------------------------
async def check_9_live_smoke() -> None:
    det = await load_one_crisis_detection()
    print(f"§9 loaded live detection: {det.dedup_key} ({det.metric} in {det.region})")
    t0 = time.perf_counter()
    inv = await invoke_investigation(det)
    dec = await invoke_decision(inv)
    report = await invoke_report(inv, dec)
    dt = time.perf_counter() - t0
    if dt > LIVE_TOTAL_LATENCY_CAP:
        _fail(f"§9 live e2e {dt:.1f}s > cap {LIVE_TOTAL_LATENCY_CAP:.0f}s")
    if not report.key_figures:
        _fail("§9 live e2e: report has zero key_figures")
    print(f"PASS §9: live 3a→3b in {dt:.1f}s "
          f"(actions={len(dec.actions)}, key_figures={len(report.key_figures)})")


def main() -> None:
    check_1_boundary_grep()
    invs = check_2_fixtures_load()
    asyncio.run(check_3_to_8(invs))
    asyncio.run(check_9_live_smoke())
    print("\nAll Layer 3b acceptance checks PASSED.")


if __name__ == "__main__":
    main()
