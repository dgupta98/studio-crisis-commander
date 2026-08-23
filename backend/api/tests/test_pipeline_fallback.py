"""Unit tests for run_pipeline fallback path."""
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
from api.fallback import CachedTriple
from api.pipeline import run_pipeline
from api.runtime import PipelineRuntime


def _mk_triple() -> CachedTriple:
    from api.tests.test_fallback import _mk_triple as helper
    return helper()


@pytest.mark.asyncio
async def test_pipeline_exception_swaps_to_fallback():
    rt = PipelineRuntime()
    await rt.register("r1")
    triple = _mk_triple()
    with patch("api.pipeline.inject_now", side_effect=RuntimeError("boom")), \
         patch("api.pipeline._cached_triple", triple), \
         patch("api.pipeline._pacing_scale", 0.0), \
         patch("api.pipeline.audit_insert"), \
         patch("api.pipeline.async_audit_attach_report", new=AsyncMock()):
        await run_pipeline(rt, "r1", request={})
    st = await rt.get("r1")
    assert st.mode == "fallback"
    assert st.status == "completed"
    types_seen = [e.type for e in st.events]
    assert types_seen[-1] == "pipeline.completed"


@pytest.mark.asyncio
async def test_force_fallback_skips_live_path():
    rt = PipelineRuntime()
    await rt.register("r1")
    triple = _mk_triple()
    with patch("api.pipeline.inject_now", side_effect=AssertionError(
            "should not be called")), \
         patch("api.pipeline._cached_triple", triple), \
         patch("api.pipeline._pacing_scale", 0.0), \
         patch("api.pipeline.audit_insert"), \
         patch("api.pipeline.async_audit_attach_report", new=AsyncMock()):
        await run_pipeline(rt, "r1", request={}, force_fallback=True)
    st = await rt.get("r1")
    assert st.mode == "fallback"
    assert st.status == "completed"
