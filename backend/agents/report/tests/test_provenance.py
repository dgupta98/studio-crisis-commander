"""Unit tests for _validate_report_provenance."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)
from agents.report._provenance import validate_report_provenance
from agents.report.contracts import ExecutiveReport, FindingSource, KeyFigure


def _inv() -> InvestigationResult:
    det = DetectionIn(
        metric_ts=datetime(2026, 1, 1, tzinfo=timezone.utc), metric="m",
        film_id=1, region="US-CA", detector="t", baseline_value=0.5,
        actual_value=0.2, magnitude=-0.6, business_impact=1.0,
        severity=1.0, dedup_key="k",
    )
    findings = [
        SignalFinding(signal="numeric_context",
                      sql="SELECT sum FROM roll_sentiment_hourly WHERE 1",
                      columns=["x"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
        SignalFinding(signal="text_reason",
                      sql="SELECT raw_text FROM reviews_text WHERE 2",
                      columns=["y"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
        SignalFinding(signal="categorical_isolation",
                      sql="SELECT region FROM roll_sentiment_hourly WHERE 3",
                      columns=["z"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
        SignalFinding(signal="temporal_context",
                      sql="SELECT ts FROM detections WHERE 4",
                      columns=["w"], rows=[[1]],
                      narrative="Baseline narrative that's long enough."),
    ]
    return InvestigationResult(
        detection=det, findings=findings,
        hypothesis=Hypothesis(
            primary_cause="Test primary cause with enough characters here.",
            contributing_factors=[], confidence="medium",
            citations=["numeric_context"],
        ),
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def _dec(inv: InvestigationResult) -> DecisionResult:
    return DecisionResult(
        decision_id="d-1", investigation_id=inv.investigation_id,
        actions=[RecommendedAction(
            action_type="issue_pr_statement",
            rationale="Test rationale with sufficient character length here.",
            params={"film_id": 1, "region": "US-CA", "message_theme": "x"},
            impact_usd=100.0,
            impact_sql="SELECT toFloat64(100.0) AS impact_usd",
            priority=1,
        )],
        status="auto_executed", threshold_usd=5000.0,
        created_at=datetime.now(timezone.utc), latency_ms=0,
    )


def _report(source_query: str, source: FindingSource) -> ExecutiveReport:
    return ExecutiveReport(
        report_id="r-1", decision_id="d-1",
        headline="Test headline with more than the twenty char minimum here.",
        tldr="Test tldr text that is comfortably above the forty character minimum ok.",
        key_figures=[KeyFigure(label="key", value="v",
                               source_query=source_query, source=source)],
        recommended_actions_prose=(
            "Prose section with sufficient length to clear the minimum threshold."
        ),
        risks_and_caveats="Caveat.",
        created_at=datetime.now(timezone.utc),
    )


def test_provenance_ok_when_source_query_matches_finding():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=inv.findings[0].sql,
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert ok, violations


def test_provenance_ok_when_source_query_matches_impact_sql():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=dec.actions[0].impact_sql,
        source=FindingSource(signal="decision_impact", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert ok, violations


def test_provenance_fails_when_source_query_is_fabricated():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query="SELECT * FROM some_table_the_agent_invented",
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert not ok
    assert violations and "fabricated" in violations[0].lower() or "not found" in violations[0].lower()


def test_provenance_fails_on_wrong_signal_binding():
    """source_query matches an impact_sql, but source claims it's from numeric_context."""
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=dec.actions[0].impact_sql,
        source=FindingSource(signal="numeric_context", query_index=0),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert not ok


def test_provenance_fails_on_out_of_range_query_index():
    inv = _inv()
    dec = _dec(inv)
    r = _report(
        source_query=dec.actions[0].impact_sql,
        source=FindingSource(signal="decision_impact", query_index=5),
    )
    ok, violations = validate_report_provenance(r, inv, dec)
    assert not ok
