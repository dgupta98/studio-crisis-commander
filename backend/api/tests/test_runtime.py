"""Unit tests for PipelineRuntime — pure in-memory, no LLM, no ClickHouse."""
from __future__ import annotations

import asyncio
import time

import pytest

from api.events import SseEvent
from api.runtime import PipelineRuntime


def _mk_event(seq: int, t: str = "x", data=None) -> SseEvent:
    return SseEvent(seq=seq, type=t, data=data or {})


@pytest.mark.asyncio
async def test_register_and_lookup():
    rt = PipelineRuntime()
    st = await rt.register("run-1")
    assert st.run_id == "run-1"
    assert st.status == "running"
    assert st.mode == "live"
    assert (await rt.get("run-1")) is st
    assert (await rt.get("no-such")) is None


@pytest.mark.asyncio
async def test_emit_captures_in_replay():
    rt = PipelineRuntime()
    await rt.register("r")
    await rt.emit("r", _mk_event(0, "pipeline.started"))
    await rt.emit("r", _mk_event(1, "detection.completed"))
    st = await rt.get("r")
    assert [e.type for e in st.events] == ["pipeline.started", "detection.completed"]


@pytest.mark.asyncio
async def test_subscribe_replays_then_tails():
    rt = PipelineRuntime()
    await rt.register("r")
    await rt.emit("r", _mk_event(0, "a"))
    await rt.emit("r", _mk_event(1, "b"))

    got: list[str] = []

    async def consume():
        async for ev in rt.subscribe("r"):
            got.append(ev.type)
            if ev.type == "end":
                break

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)          # let subscriber attach + replay
    await rt.emit("r", _mk_event(2, "c"))
    await rt.emit("r", _mk_event(3, "end"))
    await asyncio.wait_for(task, timeout=1.0)
    assert got == ["a", "b", "c", "end"]


@pytest.mark.asyncio
async def test_multiple_subscribers_see_same_stream():
    rt = PipelineRuntime()
    await rt.register("r")
    await rt.emit("r", _mk_event(0, "a"))

    got1: list[str] = []
    got2: list[str] = []

    async def consume(bucket):
        async for ev in rt.subscribe("r"):
            bucket.append(ev.type)
            if ev.type == "end":
                break

    t1 = asyncio.create_task(consume(got1))
    t2 = asyncio.create_task(consume(got2))
    await asyncio.sleep(0.05)
    await rt.emit("r", _mk_event(1, "b"))
    await rt.emit("r", _mk_event(2, "end"))
    await asyncio.wait_for(asyncio.gather(t1, t2), timeout=1.0)
    assert got1 == ["a", "b", "end"]
    assert got2 == ["a", "b", "end"]


@pytest.mark.asyncio
async def test_subscribe_unknown_run_yields_nothing():
    rt = PipelineRuntime()
    got = []
    async for ev in rt.subscribe("no-such"):
        got.append(ev)
    assert got == []


@pytest.mark.asyncio
async def test_ttl_evicts_oldest_beyond_max():
    rt = PipelineRuntime(max_runs=3, max_age_seconds=1000)
    for i in range(5):
        await rt.register(f"r{i}")
        await rt.emit(f"r{i}", _mk_event(0))
    # After 5 registers with cap 3, only the newest 3 remain.
    remaining = [r for r in ["r0", "r1", "r2", "r3", "r4"]
                 if (await rt.get(r)) is not None]
    assert remaining == ["r2", "r3", "r4"]


@pytest.mark.asyncio
async def test_ttl_evicts_older_than_age():
    rt = PipelineRuntime(max_runs=100, max_age_seconds=0.1)
    await rt.register("old")
    await rt.emit("old", _mk_event(0))
    await asyncio.sleep(0.15)
    # A new emit triggers eviction pass; older run is dropped.
    await rt.register("fresh")
    await rt.emit("fresh", _mk_event(0))
    assert (await rt.get("old")) is None
    assert (await rt.get("fresh")) is not None


@pytest.mark.asyncio
async def test_decision_index_lookup():
    rt = PipelineRuntime()
    await rt.register("r-1")
    await rt.set_decision_id("r-1", "dec-abc")
    assert await rt.run_id_for_decision("dec-abc") == "r-1"
    assert await rt.run_id_for_decision("nope") is None


@pytest.mark.asyncio
async def test_mark_terminal_sends_sentinel_to_subscribers():
    rt = PipelineRuntime()
    await rt.register("r")
    got: list[str] = []

    async def consume():
        async for ev in rt.subscribe("r"):
            got.append(ev.type)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    await rt.emit("r", _mk_event(0, "pipeline.completed"))
    await rt.mark_terminal("r", "completed")
    await asyncio.wait_for(task, timeout=1.0)
    assert got == ["pipeline.completed"]
    st = await rt.get("r")
    assert st.status == "completed"


@pytest.mark.asyncio
async def test_mark_mode_switches_to_fallback():
    rt = PipelineRuntime()
    await rt.register("r")
    await rt.mark_mode("r", "fallback")
    st = await rt.get("r")
    assert st.mode == "fallback"
