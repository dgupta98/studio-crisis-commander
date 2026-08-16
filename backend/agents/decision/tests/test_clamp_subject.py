"""_clamp_subject_params overrides LLM-hallucinated film_id/region.

Regression: Flash occasionally emits a different film (e.g. 12345/EU-DE)
than the anomaly subject, driving impact SQL to 0 and polluting the Report.
The clamp restores the detection's film/region deterministically.
"""
from __future__ import annotations

from agents.decision.agent import _clamp_subject_params
from agents.decision.contracts import RecommendedAction


def _action(action_type: str, **params: object) -> RecommendedAction:
    return RecommendedAction(
        action_type=action_type,
        rationale="tying action to a specific finding for tests" * 2,
        params=dict(params),
        priority=1,
    )


def test_clamp_overrides_wrong_film_and_region():
    a = _action(
        "swap_trailer_variant",
        film_id=12345, region="EU-DE",
        from_variant="A", to_variant="B",
    )
    _clamp_subject_params([a], det_film_id=37, det_region="NA")
    assert a.params["film_id"] == 37
    assert a.params["region"] == "NA"
    # Non-subject params must survive untouched.
    assert a.params["from_variant"] == "A"
    assert a.params["to_variant"] == "B"


def test_clamp_leaves_matching_subject_unchanged():
    a = _action(
        "shift_marketing_spend",
        film_id=37, region="NA",
        from_channel="social", to_channel="search",
        shift_pct=0.5, window_days=7,
    )
    _clamp_subject_params([a], det_film_id=37, det_region="NA")
    assert a.params["film_id"] == 37
    assert a.params["region"] == "NA"
    assert a.params["shift_pct"] == 0.5


def test_clamp_skips_action_types_without_film_or_region():
    a = _action("escalate_to_human", reason="ambiguous", severity="high")
    _clamp_subject_params([a], det_film_id=99, det_region="Korea")
    assert "film_id" not in a.params
    assert "region" not in a.params


def test_clamp_processes_multiple_actions():
    a1 = _action(
        "swap_trailer_variant",
        film_id=1, region="X",
        from_variant="A", to_variant="B",
    )
    a2 = _action(
        "issue_pr_statement",
        film_id=2, region="Y",
        message_theme="clarification",
    )
    _clamp_subject_params([a1, a2], det_film_id=42, det_region="India")
    assert a1.params["film_id"] == 42 and a1.params["region"] == "India"
    assert a2.params["film_id"] == 42 and a2.params["region"] == "India"
