"""on_event callback is optional and, when passed, fires per action."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agents.decision.agent import invoke_decision


@pytest.mark.asyncio
async def test_on_event_kwarg_is_optional():
    """Default call (no kwarg) still works — proves signature is
    backward-compatible. Uses a stub for the underlying pipeline."""
    with patch("agents.decision.agent._run_pipeline",
               new=AsyncMock(return_value="RESULT_SENTINEL")):
        result = await invoke_decision(inv="dummy")   # type: ignore[arg-type]
    assert result == "RESULT_SENTINEL"


@pytest.mark.asyncio
async def test_on_event_kwarg_is_forwarded():
    """When on_event is passed, invoke_decision forwards it into _run_pipeline."""
    seen = {}

    async def fake_pipeline(inv, *, on_event=None):
        seen["got_callback"] = on_event is not None
        return "R"

    def cb(event):
        pass

    with patch("agents.decision.agent._run_pipeline", new=fake_pipeline):
        await invoke_decision(inv="dummy", on_event=cb)   # type: ignore[arg-type]
    assert seen["got_callback"] is True
