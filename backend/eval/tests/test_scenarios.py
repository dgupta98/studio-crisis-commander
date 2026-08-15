"""Scenario loader tests — JSON parses, ids are unique, 30 scenarios total."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from eval.scenarios import Scenario, load_scenarios


def test_load_scenarios_returns_thirty():
    scenarios = load_scenarios()
    assert len(scenarios) == 30


def test_scenario_ids_are_unique():
    scenarios = load_scenarios()
    ids = [s.id for s in scenarios]
    dupes = [i for i, n in Counter(ids).items() if n > 1]
    assert not dupes, f"duplicate ids: {dupes}"


def test_every_scenario_has_expected_cause_matching_crisis_type():
    scenarios = load_scenarios()
    for s in scenarios:
        assert s.expected_primary_cause == s.crisis_type, (
            f"{s.id}: expected_primary_cause={s.expected_primary_cause!r} "
            f"but crisis_type={s.crisis_type!r}"
        )


def test_all_eight_crisis_types_covered():
    scenarios = load_scenarios()
    types = {s.crisis_type for s in scenarios}
    expected = {
        "regional_sentiment_collapse", "trailer_variant_underperformance",
        "competitor_release_impact", "marketing_overspend_low_roi",
        "streaming_completion_drop", "refund_spike",
        "negative_social_virality", "review_score_divergence",
    }
    assert types == expected


def test_load_scenarios_from_custom_path(tmp_path):
    p = tmp_path / "custom.json"
    p.write_text('[{"id":"x1","crisis_type":"refund_spike","film_id":1,'
                 '"region":"US","magnitude":0.3,"expected_primary_cause":"refund_spike"}]')
    out = load_scenarios(p)
    assert len(out) == 1 and out[0].id == "x1"


def test_scenario_rejects_unknown_crisis_type():
    with pytest.raises(ValueError):
        Scenario(id="bad", crisis_type="not_a_type", film_id=1,
                 region="US", magnitude=0.3,
                 expected_primary_cause="not_a_type")
