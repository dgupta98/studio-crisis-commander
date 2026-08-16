"""sanitize_rationale strips hallucinated specifics from LLM rationale prose.

Motivating incident: Flash emitted "Trailer B in APAC has reached 70%
completion rate" for a China marketing-ROI anomaly where neither APAC nor
Trailer B nor 70% appears anywhere in the findings. The prompt asked the
model to stop; it doesn't. This is the post-LLM safety net.
"""
from __future__ import annotations

from datetime import datetime, timezone

from agents.decision.sanitize import sanitize_rationale
from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)


def _inv(*, region: str, row: list[object] | None = None) -> InvestigationResult:
    now = datetime(2026, 8, 16, tzinfo=timezone.utc)
    det = DetectionIn(
        metric_ts=now, metric="marketing_roi", film_id=42, region=region,
        detector="test", baseline_value=1.0, actual_value=0.3,
        magnitude=0.7, business_impact=1000.0, severity=8.0,
        dedup_key="k", film_title="Test Film",
    )
    rows: list[list[object]] = [row] if row is not None else []
    finding = SignalFinding(
        signal="numeric_context", sql="SELECT 1",
        columns=["c"], rows=rows, narrative="n",
    )
    hyp = Hypothesis(
        primary_cause="test cause", contributing_factors=[],
        confidence="medium", citations=["numeric_context"],
    )
    return InvestigationResult(
        detection=det, findings=[finding, finding, finding, finding],
        hypothesis=hyp, started_at=now, finished_at=now,
    )


def test_rewrites_disallowed_region_to_detection_region():
    inv = _inv(region="China")
    out = sanitize_rationale(
        "Trailer engagement in APAC dropped materially last week.", inv,
    )
    assert "APAC" not in out
    assert "China" in out


def test_leaves_matching_region_untouched():
    inv = _inv(region="China")
    out = sanitize_rationale(
        "China sentiment collapsed after the competitor release.", inv,
    )
    assert out.startswith("China sentiment collapsed")


def test_strips_variant_not_present_in_rows():
    # Rows mention variant "A" only. LLM invented "Trailer B".
    inv = _inv(region="NA", row=["A", 1234])
    out = sanitize_rationale(
        "Swap Trailer B in favour of the current leader.", inv,
    )
    assert "Trailer B" not in out
    assert "the affected variant" in out


def test_keeps_variant_that_appears_in_rows():
    inv = _inv(region="NA", row=["B", 1234])
    out = sanitize_rationale(
        "Swap Trailer B in favour of the current leader.", inv,
    )
    assert "Trailer B" in out


def test_strips_percent_not_present_in_rows():
    inv = _inv(region="NA", row=["A", 12])
    out = sanitize_rationale(
        "Completion rate dropped to 70% versus baseline.", inv,
    )
    assert "70%" not in out


def test_keeps_percent_that_appears_in_rows():
    # Row contains "70" as a literal — legit citation.
    inv = _inv(region="NA", row=["A", 70])
    out = sanitize_rationale(
        "Completion rate dropped to 70% versus baseline.", inv,
    )
    assert "70%" in out


def test_ratio_form_matches_percent_in_prose():
    # Row cell "0.7" is the ratio the LLM upscaled to "70%".
    inv = _inv(region="NA", row=[0.7])
    out = sanitize_rationale(
        "Completion rate dropped to 70% versus baseline.", inv,
    )
    assert "70%" in out


def test_full_stack_hallucination_is_scrubbed():
    inv = _inv(region="China", row=["A", 3])
    out = sanitize_rationale(
        "Trailer B in APAC has reached 70% completion. Swap it out.", inv,
    )
    assert "APAC" not in out
    assert "Trailer B" not in out
    assert "70%" not in out
    assert "China" in out
    assert "the affected variant" in out


def test_empty_and_whitespace_inputs():
    inv = _inv(region="NA")
    assert sanitize_rationale("", inv) == ""
    assert sanitize_rationale("   ", inv) == ""
