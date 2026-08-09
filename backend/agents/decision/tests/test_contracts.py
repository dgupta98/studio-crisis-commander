"""Pydantic contract tests for agents.decision.contracts."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from agents.decision.contracts import (
    ActionType, ApprovalStatus, DecisionResult, RecommendedAction,
)


def _valid_action(**over) -> RecommendedAction:
    base = dict(
        action_type="pause_campaign",
        rationale="Pausing to stop marketing overspend during a sentiment crisis.",
        params={"campaign_id": 42, "region": "EU-DE", "pause_days": 3},
        priority=1,
    )
    base.update(over)
    return RecommendedAction(**base)


def test_action_type_literal_rejects_unknown():
    with pytest.raises(ValidationError):
        RecommendedAction(
            action_type="nuke_from_orbit",   # type: ignore[arg-type]
            rationale="Trying to sneak in an unsupported action type here.",
            params={},
            priority=1,
        )


def test_rationale_min_length_enforced():
    with pytest.raises(ValidationError):
        _valid_action(rationale="short")


def test_priority_range_1_to_3():
    _valid_action(priority=1)
    _valid_action(priority=3)
    with pytest.raises(ValidationError):
        _valid_action(priority=0)
    with pytest.raises(ValidationError):
        _valid_action(priority=4)


def test_impact_usd_requires_impact_sql():
    """The whole point of the layer: numbers must trace to queries."""
    with pytest.raises(ValidationError, match="impact_sql"):
        _valid_action(impact_usd=1234.0, impact_sql="")


def test_impact_usd_none_allows_empty_sql():
    a = _valid_action(impact_usd=None, impact_sql="")
    assert a.impact_usd is None


def test_impact_sql_alone_is_allowed():
    """Orchestrator can render impact_sql before the query runs; impact_usd
    stays None until the query returns."""
    a = _valid_action(impact_usd=None, impact_sql="SELECT 1")
    assert a.impact_sql == "SELECT 1"


def _valid_decision(**over) -> DecisionResult:
    base = dict(
        decision_id="d-1",
        investigation_id="i-1",
        actions=[_valid_action()],
        status="pending_approval",
        threshold_usd=20_000.0,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        latency_ms=1_000,
    )
    base.update(over)
    return DecisionResult(**base)


def test_decision_requires_at_least_one_action():
    with pytest.raises(ValidationError):
        _valid_decision(actions=[])


def test_decision_caps_at_three_actions():
    with pytest.raises(ValidationError):
        _valid_decision(actions=[_valid_action() for _ in range(4)])


def test_status_literal_enforced():
    with pytest.raises(ValidationError):
        _valid_decision(status="lgtm")   # type: ignore[arg-type]
