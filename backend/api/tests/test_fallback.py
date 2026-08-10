"""Unit tests for fallback triple loader + replay."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.investigation.contracts import (
    DetectionIn, Hypothesis, InvestigationResult, SignalFinding,
)
from agents.report.contracts import ExecutiveReport, KeyFigure, FindingSource
from api.events import SseEvent
from api.fallback import CachedTriple, load_cached_triple, replay_cached_triple
from api.runtime import PipelineRuntime


def _mk_triple() -> CachedTriple:
    d = DetectionIn(
        metric_ts=datetime(2026, 1, 1, tzinfo=timezone.utc), metric="x.y",
        film_id=1, region="Brazil", detector="zscore", baseline_value=0.0,
        actual_value=1.0, magnitude=1.0, business_impact=0.0, severity=1.0,
        dedup_key="k",
    )
    inv = InvestigationResult(
        detection=d,
        findings=[SignalFinding(signal=s, sql="x", rows=[], narrative="n")
                  for s in ("numeric_context", "text_reason",
                            "categorical_isolation", "temporal_context")],
        hypothesis=Hypothesis(primary_cause="c", confidence="medium",
                              citations=["numeric_context"]),
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
    )
    dec = DecisionResult(
        decision_id="dec-x", investigation_id="inv-x",
        actions=[RecommendedAction(
            action_type="issue_pr_statement",
            rationale="stakeholders need clarity",
            params={"film_id": 1, "region": "Brazil", "message_theme": "t"},
            impact_usd=1000.0, impact_sql="SELECT 1000", priority=1,
        )],
        status="auto_executed", threshold_usd=5000.0,
        created_at=datetime.now(timezone.utc),
    )
    rep = ExecutiveReport(
        report_id="r-x", decision_id="dec-x",
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
    return CachedTriple(detection=d, investigation=inv, decision=dec, report=rep,
                        captured_at=datetime.now(timezone.utc),
                        source_run_id="synthetic")


def test_load_cached_triple_roundtrip(tmp_path: Path):
    t = _mk_triple()
    path = tmp_path / "triple.json"
    path.write_text(json.dumps({
        "detection": t.detection.model_dump(mode="json"),
        "investigation": t.investigation.model_dump(mode="json"),
        "decision": t.decision.model_dump(mode="json"),
        "report": t.report.model_dump(mode="json"),
        "captured_at": t.captured_at.isoformat(),
        "source_run_id": t.source_run_id,
    }))
    loaded = load_cached_triple(path)
    assert loaded.decision.decision_id == t.decision.decision_id


def test_load_cached_triple_missing_file_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_cached_triple(tmp_path / "nope.json")


@pytest.mark.asyncio
async def test_replay_emits_full_taxonomy_with_mode_fallback():
    rt = PipelineRuntime()
    await rt.register("r1")
    triple = _mk_triple()
    await replay_cached_triple(rt, "r1", triple, pacing_scale=0.0)
    st = await rt.get("r1")
    types_seen = [ev.type for ev in st.events]
    assert "pipeline.started" not in types_seen  # replay is only the stage events
    assert "detection.completed" in types_seen
    assert types_seen.count("signal.completed") == 4
    assert "decision.completed" in types_seen
    assert "report.completed" in types_seen
    assert types_seen[-1] == "pipeline.completed"
    # Every event data payload carries mode=fallback.
    for ev in st.events:
        assert ev.data.get("mode") == "fallback"
