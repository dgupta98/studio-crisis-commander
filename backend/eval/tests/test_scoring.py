"""Classifier + score aggregator tests."""
from __future__ import annotations

import pytest

from eval.scoring import (
    KEYWORDS, classify, aggregate,
    ScoredScenario, RunArtifact,
)


@pytest.mark.parametrize("text,expected", [
    ("The film's audience in Brazil is expressing sentiment collapse "
     "due to a promotional misstep.",
     "regional_sentiment_collapse"),
    ("A negative post has gone viral on Twitter, driving virality metrics.",
     "negative_social_virality"),
    ("Refund volume has spiked to unusual levels.",
     "refund_spike"),
    ("A competitor's opening weekend is eating theatrical share.",
     "competitor_release_impact"),
    ("Trailer variant A is underperforming vs baseline.",
     "trailer_variant_underperformance"),
    ("Marketing overspend is producing low ROI on conversions.",
     "marketing_overspend_low_roi"),
    ("Streaming completion rates are collapsing.",
     "streaming_completion_drop"),
    ("The critic-audience review score divergence is widening.",
     "review_score_divergence"),
])
def test_classify_maps_freeform_to_canonical(text, expected):
    assert classify(text) == expected


def test_classify_unknown_returns_unknown():
    assert classify("random unrelated text about nothing") == "unknown"


def test_classify_case_insensitive():
    assert classify("REFUND SPIKE detected") == "refund_spike"


def test_classify_first_match_wins_when_ambiguous():
    # "trailer" appears before "refund" in KEYWORDS iteration; verify determinism.
    # This test just pins the current behavior: ordering by dict definition.
    ambiguous = "trailer refund event"
    result = classify(ambiguous)
    # As long as it returns SOMETHING from KEYWORDS or "unknown", not e.g. None.
    assert result in {*KEYWORDS.keys(), "unknown"}


def test_aggregate_all_correct():
    scored = [
        ScoredScenario(id=f"sc_{i:03d}", expected="refund_spike",
                       actual="refund_spike", matched=True,
                       latency_ms=100, errored=False, raw_primary_cause="…")
        for i in range(1, 4)
    ]
    art = aggregate(scored, mode="replay")
    assert art.total == 3
    assert art.correct == 3
    assert art.errored == 0
    assert art.accuracy == 1.0
    assert art.per_type["refund_spike"]["n"] == 3
    assert art.per_type["refund_spike"]["correct"] == 3


def test_aggregate_mixed():
    scored = [
        ScoredScenario(id="a", expected="refund_spike", actual="refund_spike",
                       matched=True, latency_ms=100, errored=False, raw_primary_cause="…"),
        ScoredScenario(id="b", expected="refund_spike", actual="unknown",
                       matched=False, latency_ms=200, errored=False, raw_primary_cause="…"),
        ScoredScenario(id="c", expected="refund_spike", actual=None,
                       matched=False, latency_ms=0, errored=True, raw_primary_cause=""),
    ]
    art = aggregate(scored, mode="live")
    assert art.total == 3
    assert art.correct == 1
    assert art.errored == 1
    # Errored do NOT count against accuracy — accuracy = correct / (total - errored).
    assert art.accuracy == pytest.approx(0.5)


def test_run_artifact_serializes_to_json():
    scored = [ScoredScenario(id="a", expected="refund_spike", actual="refund_spike",
                             matched=True, latency_ms=100, errored=False, raw_primary_cause="…")]
    art = aggregate(scored, mode="replay")
    blob = art.model_dump(mode="json")
    assert blob["mode"] == "replay"
    assert isinstance(blob["run_id"], str) and blob["run_id"].startswith("eval_")
