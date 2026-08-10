"""Inject + Stream integration test (with mocked pipeline)."""
from __future__ import annotations

import asyncio
import json

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch


@pytest.mark.asyncio
async def test_inject_returns_202_and_run_id():
    from api.tests.test_fallback import _mk_triple

    async def fake_run(rt, run_id, request, *, force_fallback=False):
        from api.events import SseEvent
        await rt.emit(run_id, SseEvent(seq=0, type="pipeline.completed",
                                       data={"run_id": run_id, "latency_ms": 0,
                                             "mode": "live"}))
        await rt.mark_terminal(run_id, "completed")

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.inject.run_pipeline", new=fake_run):
        from api.main import app
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://t") as ac:
            async with ac.stream("GET", "/healthz"):  # trigger lifespan
                pass
            r = await ac.post("/inject-crisis", json={})
            assert r.status_code == 202
            body = r.json()
            assert "run_id" in body
            assert body["stream_url"].endswith(body["run_id"])


@pytest.mark.asyncio
async def test_stream_emits_terminal_and_closes():
    from api.tests.test_fallback import _mk_triple

    async def fake_run(rt, run_id, request, *, force_fallback=False):
        from api.events import SseEvent
        await rt.emit(run_id, SseEvent(seq=0, type="pipeline.started",
                                       data={"run_id": run_id, "mode": "live"}))
        await asyncio.sleep(0.05)
        await rt.emit(run_id, SseEvent(seq=1, type="pipeline.completed",
                                       data={"run_id": run_id, "latency_ms": 0,
                                             "mode": "live"}))
        await rt.mark_terminal(run_id, "completed")

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.inject.run_pipeline", new=fake_run):
        from api.main import app
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://t") as ac:
            async with ac.stream("GET", "/healthz"):
                pass
            r = await ac.post("/inject-crisis", json={})
            run_id = r.json()["run_id"]
            # Give the background task a moment to complete.
            await asyncio.sleep(0.2)
            got_types: list[str] = []
            async with ac.stream("GET",
                                 f"/stream/investigation/{run_id}") as s:
                async for line in s.aiter_lines():
                    if line.startswith("data: "):
                        body = json.loads(line[len("data: "):])
                        got_types.append(body["type"])
                        if body["type"] == "pipeline.completed":
                            break
            assert "pipeline.started" in got_types
            assert "pipeline.completed" in got_types


@pytest.mark.asyncio
async def test_stream_404_for_unknown_run():
    from api.tests.test_fallback import _mk_triple
    with patch("api.main.load_cached_triple", return_value=_mk_triple()):
        from api.main import app
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://t") as ac:
            async with ac.stream("GET", "/healthz"):
                pass
            r = await ac.get("/stream/investigation/no-such-run")
            assert r.status_code == 404
