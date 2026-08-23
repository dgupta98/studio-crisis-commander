"""Unit tests for agents.decision.actions."""

from __future__ import annotations

import pytest

from agents.decision.actions import (
    ACTION_TYPES,
    DEFAULT_THRESHOLDS_USD,
    PARAM_SPECS,
    TEMPLATES,
    compute_status,
    render_action_sql,
    validate_params,
)
from agents.decision.contracts import RecommendedAction


# ---- taxonomy completeness ----

def test_all_action_types_have_template():
    assert set(TEMPLATES.keys()) == set(ACTION_TYPES)


def test_all_action_types_have_param_spec():
    assert set(PARAM_SPECS.keys()) == set(ACTION_TYPES)


def test_all_action_types_have_threshold():
    assert set(DEFAULT_THRESHOLDS_USD.keys()) == set(ACTION_TYPES)


# ---- param validation ----

def test_validate_params_rejects_missing_required():
    with pytest.raises(ValueError, match="missing required param"):
        validate_params(
            "pause_campaign",
            {"campaign_id": 1, "region": "US-CA"},  # missing pause_days
        )


def test_validate_params_rejects_extra_keys():
    with pytest.raises(ValueError, match="unexpected param"):
        validate_params(
            "pause_campaign",
            {"campaign_id": 1, "region": "US-CA", "pause_days": 2, "junk": "x"},
        )


def test_validate_params_rejects_wrong_type():
    with pytest.raises(ValueError, match="type"):
        validate_params(
            "pause_campaign",
            {"campaign_id": "not-an-int", "region": "US-CA", "pause_days": 2},
        )


def test_validate_params_rejects_unknown_action():
    with pytest.raises(ValueError, match="unknown action_type"):
        validate_params("nuke_from_orbit", {})   # type: ignore[arg-type]


def test_validate_params_rejects_out_of_enum_channel():
    """Out-of-enum channels (e.g. 'tiktok') must raise — the seed only
    knows email/display/social/affiliate, so anything else silently
    yields impact_usd=$0."""
    with pytest.raises(ValueError, match="must be one of"):
        validate_params("shift_marketing_spend", {
            "film_id": 42, "region": "EU-West",
            "from_channel": "tiktok", "to_channel": "social",
            "shift_pct": 30.0, "window_days": 14,
        })


def test_validate_params_rejects_out_of_enum_variant():
    with pytest.raises(ValueError, match="must be one of"):
        validate_params("swap_trailer_variant", {
            "film_id": 42, "region": "EU-West",
            "from_variant": "A", "to_variant": "C",
        })


# ---- SQL render ----

def test_render_shift_marketing_spend_produces_sql():
    sql = render_action_sql(
        "shift_marketing_spend",
        {
            "film_id": 42, "region": "EU-West",
            "from_channel": "display", "to_channel": "social",
            "shift_pct": 30.0, "window_days": 14,
        },
    )
    assert "roll_campaign_daily" in sql
    assert "42" in sql
    assert "'EU-West'" in sql
    assert "'display'" in sql
    assert "'social'" in sql
    assert "impact_usd" in sql


def test_render_escalate_to_human_returns_constant_zero():
    sql = render_action_sql(
        "escalate_to_human",
        {"reason": "low confidence hypothesis", "severity": "high"},
    )
    assert "SELECT" in sql
    assert "0.0" in sql
    # No user string interpolated into SQL — reason/severity are prose only.
    assert "low confidence" not in sql


def test_render_pause_campaign():
    sql = render_action_sql(
        "pause_campaign",
        {"campaign_id": 7, "region": "US-CA", "pause_days": 5},
    )
    assert "roll_campaign_daily" in sql or "campaign_performance" in sql
    assert " 7" in sql or "= 7" in sql
    assert "'US-CA'" in sql
    assert "5" in sql


# ---- threshold / status logic ----

def _a(action_type: str, impact_usd: float | None) -> RecommendedAction:
    return RecommendedAction(
        action_type=action_type,               # type: ignore[arg-type]
        rationale="Test action with sufficient rationale text length here.",
        params={},
        impact_usd=impact_usd,
        impact_sql="SELECT 1" if impact_usd is not None else "",
        priority=1,
    )


def test_status_auto_when_all_under_threshold():
    actions = [_a("issue_pr_statement", 100.0)]  # threshold 5_000
    status, thresh = compute_status(actions)
    assert status == "auto_executed"
    assert thresh == DEFAULT_THRESHOLDS_USD["issue_pr_statement"]


def test_status_pending_when_any_over_threshold():
    actions = [
        _a("issue_pr_statement", 100.0),
        _a("shift_marketing_spend", 50_000.0),  # threshold 10_000
    ]
    status, thresh = compute_status(actions)
    assert status == "pending_approval"
    # highest-magnitude threshold that gated is shift_marketing_spend's.
    assert thresh == DEFAULT_THRESHOLDS_USD["shift_marketing_spend"]


def test_status_pending_when_escalate_present():
    actions = [_a("escalate_to_human", 0.0), _a("issue_pr_statement", 100.0)]
    status, _ = compute_status(actions)
    assert status == "pending_approval"


def test_status_pending_when_impact_unknown():
    """impact_usd=None means SQL failed — safest to require approval."""
    actions = [_a("pause_campaign", None)]
    status, _ = compute_status(actions)
    assert status == "pending_approval"
