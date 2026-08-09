"""Layer 3b touch: InvestigationResult must expose an id."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)


def _sample_finding(name: str) -> SignalFinding:
    return SignalFinding(
        signal=name,               # type: ignore[arg-type]
        sql="SELECT 1",
        columns=["x"],
        rows=[[1]],
        narrative="baseline for the test — pretend this is a real narrative.",
    )


def _sample_result() -> InvestigationResult:
    det = DetectionIn(
        metric_ts=datetime(2026, 1, 1, tzinfo=timezone.utc),
        metric="audience_sentiment.avg", film_id=1, region="US-CA",
        detector="test", baseline_value=0.5, actual_value=0.2,
        magnitude=-0.6, business_impact=1000.0, severity=1.0,
        dedup_key="k",
    )
    hyp = Hypothesis(
        primary_cause="Test cause exceeding twenty-five characters minimum.",
        contributing_factors=[], confidence="medium",
        citations=["numeric_context"],
    )
    return InvestigationResult(
        detection=det,
        findings=[
            _sample_finding("numeric_context"),
            _sample_finding("text_reason"),
            _sample_finding("categorical_isolation"),
            _sample_finding("temporal_context"),
        ],
        hypothesis=hyp,
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_investigation_id_auto_generated():
    r = _sample_result()
    assert isinstance(r.investigation_id, str)
    assert len(r.investigation_id) == 32  # UUID4 hex


def test_investigation_id_unique_per_instance():
    a = _sample_result()
    b = _sample_result()
    assert a.investigation_id != b.investigation_id


def test_investigation_id_round_trips_through_json():
    r = _sample_result()
    reloaded = InvestigationResult.model_validate_json(r.model_dump_json())
    assert reloaded.investigation_id == r.investigation_id
