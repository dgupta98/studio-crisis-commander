"""on_event kwarg is optional and, when passed, forwards into pipeline."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agents.investigation.agent import invoke_investigation


@pytest.mark.asyncio
async def test_on_event_kwarg_optional():
    with patch("agents.investigation.agent._run_pipeline",
               new=AsyncMock(return_value="INV_SENTINEL")):
        result = await invoke_investigation(detection="dummy")   # type: ignore[arg-type]
    assert result == "INV_SENTINEL"


@pytest.mark.asyncio
async def test_on_event_kwarg_forwarded():
    seen = {}

    async def fake_pipeline(det, *, on_event=None):
        seen["got_callback"] = on_event is not None
        return "R"

    def cb(event):
        pass

    with patch("agents.investigation.agent._run_pipeline", new=fake_pipeline):
        await invoke_investigation(detection="dummy", on_event=cb)   # type: ignore[arg-type]
    assert seen["got_callback"] is True
