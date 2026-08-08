"""Unit tests for investigation.contracts Pydantic models."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from agents.investigation.contracts import (
    DetectionIn,
    Hypothesis,
    InvestigationResult,
    SignalFinding,
)


def _det() -> DetectionIn:
    return DetectionIn(
        metric_ts=datetime(2023, 6, 1, 12, 0, 0, tzinfo=timezone.utc),
        metric="audience_sentiment.avg_score",
        film_id=42,
        region="EU-DE",
        detector="zscore",
        baseline_value=0.68,
        actual_value=0.31,
        magnitude=-3.7,
        business_impact=0.42,
        severity=1.55,
        dedup_key="audience_sentiment.avg_score|42|EU-DE|2023-06-01 12:00:00|zscore",
    )


def _finding(signal: str) -> SignalFinding:
    return SignalFinding(
        signal=signal,
        sql="SELECT ts, avg_score FROM roll_sentiment_hourly WHERE film_id=42",
        columns=["ts", "avg_score"],
        rows=[["2023-06-01 12:00:00", 0.31]],
        narrative="Sentiment dropped from 0.68 to 0.31 in the last hour.",
        latency_ms=1200,
    )


def test_detection_in_accepts_layer2_row_shape():
    d = _det()
    assert d.metric == "audience_sentiment.avg_score"
    assert d.film_id == 42


def test_signal_finding_signal_is_literal():
    with pytest.raises(Exception):  # ValidationError
        SignalFinding(
            signal="bogus_signal",
            sql="SELECT 1", columns=[], rows=[], narrative="x", latency_ms=0,
        )


def test_hypothesis_requires_non_empty_citations():
    with pytest.raises(Exception):
        Hypothesis(
            primary_cause="EU-DE sentiment collapse driven by dubbing complaints.",
            contributing_factors=[],
            confidence="medium",
            citations=[],
        )


def test_hypothesis_rejects_unknown_citation():
    with pytest.raises(Exception):
        Hypothesis(
            primary_cause="x" * 30,
            contributing_factors=[],
            confidence="medium",
            citations=["numeric_context", "bogus_signal"],  # bogus not in Literal
        )


def test_hypothesis_accepts_valid_citation_subset():
    h = Hypothesis(
        primary_cause="x" * 30,
        contributing_factors=[],
        confidence="high",
        citations=["numeric_context", "categorical_isolation"],
    )
    assert h.confidence == "high"
    assert len(h.citations) == 2


def test_investigation_result_full_shape():
    d = _det()
    findings = [_finding(s) for s in
                ("numeric_context", "text_reason",
                 "categorical_isolation", "temporal_context")]
    h = Hypothesis(
        primary_cause="Sentiment collapse in EU-DE from dubbing complaints." * 1,
        contributing_factors=["Trailer B variant underperforming in DACH region."],
        confidence="high",
        citations=["numeric_context", "text_reason", "categorical_isolation"],
    )
    r = InvestigationResult(
        detection=d,
        findings=findings,
        hypothesis=h,
        started_at=datetime(2023, 6, 1, 12, 5, tzinfo=timezone.utc),
        finished_at=datetime(2023, 6, 1, 12, 5, 15, tzinfo=timezone.utc),
    )
    assert len(r.findings) == 4
    assert r.hypothesis.confidence == "high"
