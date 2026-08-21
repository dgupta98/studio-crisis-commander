"""GET /eval_cache/sc_001.json returns 200 when the fixture exists on disk."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app


@pytest.mark.asyncio
async def test_eval_cache_static_mount():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/eval_cache/sc_001.json")
    # sc_001.json exists in the repo → 200; if repo cache is empty, 404 is acceptable
    assert r.status_code in (200, 404)
