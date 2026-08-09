"""Contract tests for AuditRow. Live-DB tests live in acceptance.py."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.decision.audit import AuditRow
from agents.decision.contracts import DecisionResult, RecommendedAction


def _sample_row() -> AuditRow:
    action = RecommendedAction(
        action_type="pause_campaign",
        rationale="Pausing campaign to reduce overspend detected in EU-DE.",
        params={"campaign_id": 42, "region": "EU-DE", "pause_days": 3},
        impact_usd=15_000.0,
        impact_sql="SELECT toFloat64(15000.0) AS impact_usd",
        priority=1,
    )
    dec = DecisionResult(
        decision_id="d-1", investigation_id="i-1",
        actions=[action], status="pending_approval",
        threshold_usd=20_000.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        latency_ms=1234,
    )
    return AuditRow(
        decision_id="d-1", investigation_id="i-1",
        detection_dedup_key="k-1", film_id=42, region="EU-DE",
        actions=[action], status="pending_approval",
        threshold_usd=20_000.0, agent_run=dec, report=None,
        approval_status="pending_approval",
        approver="", approval_note="", approved_at=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_audit_row_round_trips_through_json():
    r = _sample_row()
    reloaded = AuditRow.model_validate_json(r.model_dump_json())
    assert reloaded.decision_id == "d-1"
    assert reloaded.agent_run.decision_id == "d-1"
    assert reloaded.actions[0].impact_usd == 15_000.0
    assert reloaded.report is None


def test_audit_row_preserves_timezone():
    r = _sample_row()
    reloaded = AuditRow.model_validate_json(r.model_dump_json())
    assert reloaded.created_at.tzinfo is not None
