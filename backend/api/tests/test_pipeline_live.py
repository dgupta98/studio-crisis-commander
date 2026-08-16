"""Unit tests for run_pipeline live path — all invoke_* mocked."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)
from agents.report.contracts import ExecutiveReport, KeyFigure, FindingSource
from api.pipeline import run_pipeline
from api.runtime import PipelineRuntime


def _fake_det() -> DetectionIn:
    return DetectionIn(
        metric_ts=datetime.now(timezone.utc), metric="x.y", film_id=1,
        region="Brazil", detector="zscore", baseline_value=0.0,
        actual_value=1.0, magnitude=1.0, business_impact=0.0,
        severity=1.0, dedup_key="x.y|1|Brazil|now|zscore",
    )


def _fake_inv() -> InvestigationResult:
    d = _fake_det()
    findings = [SignalFinding(signal=s, sql=f"SELECT {i}", rows=[[1]],
                              narrative="n") for i, s in enumerate(
        ("numeric_context", "text_reason", "categorical_isolation",
         "temporal_context"))]
    return InvestigationResult(
        detection=d, findings=findings,
        hypothesis=Hypothesis(primary_cause="c", confidence="medium",
                              citations=["numeric_context"]),
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
    )


def _fake_dec() -> DecisionResult:
    return DecisionResult(
        decision_id=uuid4().hex, investigation_id="inv-1",
        actions=[RecommendedAction(
            action_type="issue_pr_statement",
            rationale="stakeholders need clarity",
            params={"film_id": 1, "region": "Brazil", "message_theme": "t"},
            impact_usd=1000.0, impact_sql="SELECT 1000",
            priority=1,
        )],
        status="auto_executed", threshold_usd=5000.0,
        created_at=datetime.now(timezone.utc),
    )


def _fake_report(dec_id: str) -> ExecutiveReport:
    return ExecutiveReport(
        report_id="r1", decision_id=dec_id,
        headline="A short headline that clears the twenty-char floor.",
        tldr="A tldr summary that clears the forty character minimum length rule.",
        key_figures=[KeyFigure(label="impact", value="$1K",
                               source_query="SELECT 1000",
                               source=FindingSource(signal="decision_impact",
                                                    query_index=0))],
        recommended_actions_prose="issue PR statement immediately targeting brazil",
        risks_and_caveats="confidence medium",
        created_at=datetime.now(timezone.utc), latency_ms=100,
    )


@pytest.mark.asyncio
async def test_run_pipeline_live_happy_path_emits_full_taxonomy():
    rt = PipelineRuntime()
    await rt.register("r1")
    fake_crisis = MagicMock()
    dec = _fake_dec()
    with patch("api.pipeline.inject_now", return_value=fake_crisis), \
         patch("api.pipeline.produce_detection",
               new=AsyncMock(return_value=(_fake_det(), "refresh"))), \
         patch("api.pipeline.invoke_investigation",
               new=AsyncMock(return_value=_fake_inv())), \
         patch("api.pipeline.invoke_decision",
               new=AsyncMock(return_value=dec)), \
         patch("api.pipeline.invoke_report",
               new=AsyncMock(return_value=_fake_report(dec.decision_id))):
        await run_pipeline(rt, "r1", request={})
    st = await rt.get("r1")
    types_seen = [ev.type for ev in st.events]
    assert types_seen[0] == "pipeline.started"
    assert "detection.started" in types_seen
    assert "detection.completed" in types_seen
    assert "investigation.started" in types_seen
    assert "investigation.completed" in types_seen
    assert "decision.started" in types_seen
    assert "decision.completed" in types_seen
    assert "report.started" in types_seen
    assert "report.completed" in types_seen
    assert types_seen[-1] == "pipeline.completed"
    assert st.status == "completed"
    assert st.decision_id == dec.decision_id


@pytest.mark.asyncio
async def test_run_pipeline_sub_agent_events_pass_through():
    """Investigation's on_event fires signal.completed x4, but our mocked
    invoke_investigation doesn't invoke on_event. Instead verify the
    on_event we pass in is a runtime-aware callable that emits into rt."""
    rt = PipelineRuntime()
    await rt.register("r1")
    fake_crisis = MagicMock()

    captured_cb = {}

    async def fake_invoke_inv(det, *, on_event=None):
        # Call the callback like the real agent would.
        for sig in ("numeric_context", "text_reason", "categorical_isolation",
                    "temporal_context"):
            on_event({"type": "signal.completed",
                      "data": {"finding": {
                          "signal": sig, "sql": "x",
                          "narrative": "", "row_count": 0,
                      }}})
        captured_cb["ok"] = True
        return _fake_inv()

    dec = _fake_dec()
    with patch("api.pipeline.inject_now", return_value=fake_crisis), \
         patch("api.pipeline.produce_detection",
               new=AsyncMock(return_value=(_fake_det(), "refresh"))), \
         patch("api.pipeline.invoke_investigation", new=fake_invoke_inv), \
         patch("api.pipeline.invoke_decision",
               new=AsyncMock(return_value=dec)), \
         patch("api.pipeline.invoke_report",
               new=AsyncMock(return_value=_fake_report(dec.decision_id))):
        await run_pipeline(rt, "r1", request={})
    st = await rt.get("r1")
    signal_events = [e for e in st.events if e.type == "signal.completed"]
    assert len(signal_events) == 4
