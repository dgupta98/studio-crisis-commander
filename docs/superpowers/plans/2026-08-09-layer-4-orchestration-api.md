# Layer 4 — Orchestration API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single FastAPI app that streams the live Detection→Investigation→Decision→Report pipeline over SSE, exposes read/approval endpoints for the dashboard, and falls back to a cached pipeline triple if the live path fails mid-demo.

**Architecture:** In-memory `PipelineRuntime` owns a per-run replay buffer + subscriber fan-out (asyncio queues). A background `asyncio` task per run executes the four existing stage entrypoints, emitting SSE events through the runtime. Read endpoints (`/detections`, `/audit`, `/metrics`) hit ClickHouse directly via `data.ch_client`; write endpoints (`/approve`, `/deny`) go through the existing `agents.decision.audit` facade.

**Tech Stack:** Python 3.12, FastAPI ≥ 0.111, uvicorn[standard] ≥ 0.29, sse-starlette (bundled with FastAPI's `StreamingResponse` — no extra dep needed), Pydantic v2, pytest, httpx (for TestClient + SSE test harness), `clickhouse-connect` (permitted in `api/`), existing Layer 3a/3b public entrypoints.

**Reference spec:** `docs/superpowers/specs/2026-08-09-layer-4-orchestration-api-design.md`

---

## Prerequisites & conventions

Read before Task 1:

- **Working directory for all commands:** `backend/`. Venv at `backend/venv/`. Run Python as `./venv/bin/python`; modules as `./venv/bin/python -m <dotted.path>`; pytest as `./venv/bin/pytest`.
- **Layers 1, 2, 3a, 3b must be merged and passing.** Verify:
  - `PYTHONPATH=. ./venv/bin/python -m agents.decision.acceptance` exits 0 (9/9).
  - `PYTHONPATH=. ./venv/bin/python -c "from data.ch_client import client; c=client().__enter__(); print(c.query('SELECT count() FROM detections').result_rows[0][0])"` prints > 0.
- **`.env` already configured.** Do NOT read or print `.env`.
- **New boundary for Layer 4:** `api/` MAY import `data.ch_client` and `clickhouse_connect` directly. `api/` MUST NOT import agents' *internals* — only the public entrypoints listed here:
  - `agents.investigation.agent.invoke_investigation`
  - `agents.investigation.contracts.DetectionIn, InvestigationResult, SignalFinding, Hypothesis`
  - `agents.decision.agent.invoke_decision`
  - `agents.decision.contracts.DecisionResult, RecommendedAction, ApprovalStatus, ActionType`
  - `agents.decision.audit.list_recent_audit, get_audit, async_get_audit, async_approve_decision, deny_decision, AuditRow`
  - `agents.report.agent.invoke_report`
  - `agents.report.contracts.ExecutiveReport, KeyFigure, FindingSource`
  - `data.crisis_injector.inject_now`
  - `data.ground_truth.Crisis, CrisisType`
  - `data.mv.refresh.refresh_detections`
- **No Co-Authored-By trailers in commits.**
- **Existing agent contracts are not to be changed except one thing:** `invoke_investigation` and `invoke_decision` gain an optional keyword-only `on_event: Callable[[dict], None] | None = None` parameter. Callers who don't pass it see zero behavior change. This is the ONLY agent-side touchpoint in Layer 4.
- **File conventions match Layers 3a/3b:** `from __future__ import annotations`, module docstring, `if __name__ == "__main__"` block for runnable modules.
- **Test conventions:** pytest with `pytest-asyncio` (already installed via ADK deps). Tests that need a running app use `fastapi.testclient.TestClient`. Tests that need SSE parsing use `httpx.AsyncClient` with `stream=True`.

---

## File responsibility map

Locking in decomposition before writing tasks:

| File | Responsibility |
|---|---|
| `api/events.py` | `SseEvent` dataclass + `serialize()` producing SSE wire bytes. |
| `api/runtime.py` | `PipelineRuntime`, `RunState`, replay buffer, subscriber fan-out, TTL, `decision_id → run_id` reverse index. |
| `api/pipeline.py` | `run_pipeline(runtime, run_id, request, force_fallback)`: detection sourcing (refresh+select or synth), stage execution, on_event emission, fallback trigger. |
| `api/fallback.py` | `load_cached_triple()`, `replay_cached_triple()`, pacing table. |
| `api/cached/fallback_triple.json` | Committed cached pipeline artifact. |
| `api/main.py` | FastAPI app: startup (load cached triple, instantiate runtime), CORS, mount routers. |
| `api/routers/inject.py` | `POST /inject-crisis`. |
| `api/routers/stream.py` | `GET /stream/investigation/{run_id}`. |
| `api/routers/detections.py` | `GET /detections`. |
| `api/routers/audit.py` | `GET /audit`, `POST /approve/{decision_id}`, `POST /deny/{decision_id}`. |
| `api/routers/metrics.py` | `GET /metrics/{film_id}/{region}`. |
| `api/tests/*.py` | Unit tests + `acceptance.py`. |
| `api/tests/regenerate_fallback.py` | Script to regenerate `cached/fallback_triple.json`. |
| `Dockerfile` | Cloud Run container build (uvicorn). |

---

## Task 1: Scaffold package structure

**Files:**
- Create: `backend/api/__init__.py`
- Create: `backend/api/routers/__init__.py`
- Create: `backend/api/tests/__init__.py`
- Create: `backend/api/cached/.gitkeep`

- [ ] **Step 1: Verify state**

Run: `ls backend/`
Expected: shows `agents/`, `data/`, `mcp_integration/`, `requirements.txt`, `venv/`. No `api/` directory yet.

- [ ] **Step 2: Create package skeletons**

```bash
mkdir -p backend/api/routers backend/api/tests backend/api/cached
touch backend/api/__init__.py
touch backend/api/routers/__init__.py
touch backend/api/tests/__init__.py
touch backend/api/cached/.gitkeep
```

- [ ] **Step 3: Verify imports work**

Run: `cd backend && PYTHONPATH=. ./venv/bin/python -c "import api, api.routers, api.tests"`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add backend/api/
git commit -m "chore(api): scaffold Layer 4 package structure"
```

---

## Task 2: SseEvent contract + wire format

**Files:**
- Create: `backend/api/events.py`
- Create: `backend/api/tests/test_events.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/api/tests/test_events.py`:

```python
"""Unit tests for SseEvent wire format."""
from __future__ import annotations

import json
import re

from api.events import SseEvent


def test_serialize_wire_format():
    ev = SseEvent(seq=3, type="pipeline.started",
                  data={"run_id": "abc", "mode": "live"})
    wire = ev.serialize()
    assert isinstance(wire, bytes)
    text = wire.decode("utf-8")
    # Two lines: `event: <type>` then `data: <json>`; terminated by blank line.
    assert text.startswith("event: pipeline.started\n")
    assert "\ndata: " in text
    assert text.endswith("\n\n")
    body_line = [ln for ln in text.split("\n") if ln.startswith("data: ")][0]
    body = json.loads(body_line[len("data: "):])
    assert body["seq"] == 3
    assert body["type"] == "pipeline.started"
    assert body["data"] == {"run_id": "abc", "mode": "live"}
    # ISO 8601 UTC with trailing Z or +00:00.
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", body["ts"])


def test_serialize_escapes_newlines_in_data():
    """SSE spec requires data to be single-line-per-`data:` prefix.
    We JSON-encode the payload so newlines never leak into the wire."""
    ev = SseEvent(seq=1, type="x", data={"note": "line1\nline2"})
    text = ev.serialize().decode("utf-8")
    # `data:` should appear exactly once (JSON-encoding hides the newline).
    assert text.count("data: ") == 1


def test_seq_and_ts_readable_from_dict_form():
    """as_dict() gives the same payload we JSON-encode into the wire."""
    ev = SseEvent(seq=0, type="detection.started", data={})
    d = ev.as_dict()
    assert d["seq"] == 0
    assert d["type"] == "detection.started"
    assert d["data"] == {}
    assert "ts" in d
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_events.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.events'`.

- [ ] **Step 3: Implement events.py**

Create `backend/api/events.py`:

```python
"""SseEvent — serializes one pipeline event to Server-Sent-Events wire format.

Wire form (per event):
    event: <type>\n
    data: <json blob {seq, ts, type, data}>\n
    \n

We keep the JSON blob on a single `data:` line — SSE readers rejoin
multi-line `data:` blocks with '\\n', which corrupts JSON. JSON-encoding
also hides newlines inside string values.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@dataclass(slots=True)
class SseEvent:
    seq: int
    type: str
    data: dict[str, Any]
    ts: str = field(default_factory=_now_iso)

    def as_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "ts": self.ts, "type": self.type,
                "data": self.data}

    def serialize(self) -> bytes:
        body = json.dumps(self.as_dict(), separators=(",", ":"), default=str)
        return f"event: {self.type}\ndata: {body}\n\n".encode("utf-8")
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_events.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/api/events.py backend/api/tests/test_events.py
git commit -m "feat(api): SseEvent contract + wire format"
```

---

## Task 3: PipelineRuntime — registry, replay, fan-out, TTL

**Files:**
- Create: `backend/api/runtime.py`
- Create: `backend/api/tests/test_runtime.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/api/tests/test_runtime.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_runtime.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.runtime'`.

- [ ] **Step 3: Implement runtime.py**

Create `backend/api/runtime.py`:

```python
"""PipelineRuntime — in-memory registry of live/completed pipeline runs.

One process-global instance is created in api.main at startup. Each POST
/inject-crisis registers a RunState; the background pipeline task calls
emit() with SseEvents; the SSE handler calls subscribe() and streams to
the browser.

Concurrency: a single asyncio.Lock guards `runs` and `_decision_index`.
Each RunState owns its own event buffer and subscriber list (also mutated
under the runtime lock — cheap because operations are constant-time).
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import AsyncIterator, Literal

from api.events import SseEvent

RunMode = Literal["live", "fallback"]
RunStatus = Literal["running", "completed", "failed"]

_SENTINEL = object()   # placed into subscriber queues to signal end-of-stream


@dataclass(slots=True)
class RunState:
    run_id: str
    created_at: float                     # time.monotonic()
    mode: RunMode = "live"
    status: RunStatus = "running"
    decision_id: str | None = None
    events: list[SseEvent] = field(default_factory=list)
    subscribers: list[asyncio.Queue] = field(default_factory=list)


class PipelineRuntime:
    def __init__(self, *, max_runs: int = 50, max_age_seconds: float = 900.0):
        self._runs: dict[str, RunState] = {}
        self._decision_index: dict[str, str] = {}  # decision_id -> run_id
        self._order: deque[str] = deque()          # insertion order for eviction
        self._lock = asyncio.Lock()
        self._max_runs = max_runs
        self._max_age_seconds = max_age_seconds

    # --- lifecycle -----------------------------------------------------
    async def register(self, run_id: str) -> RunState:
        async with self._lock:
            self._evict_locked()
            state = RunState(run_id=run_id, created_at=time.monotonic())
            self._runs[run_id] = state
            self._order.append(run_id)
            return state

    async def get(self, run_id: str) -> RunState | None:
        async with self._lock:
            return self._runs.get(run_id)

    async def mark_mode(self, run_id: str, mode: RunMode) -> None:
        async with self._lock:
            st = self._runs.get(run_id)
            if st is not None:
                st.mode = mode

    async def set_decision_id(self, run_id: str, decision_id: str) -> None:
        async with self._lock:
            st = self._runs.get(run_id)
            if st is None:
                return
            st.decision_id = decision_id
            self._decision_index[decision_id] = run_id

    async def run_id_for_decision(self, decision_id: str) -> str | None:
        async with self._lock:
            return self._decision_index.get(decision_id)

    async def mark_terminal(self, run_id: str, status: RunStatus) -> None:
        async with self._lock:
            st = self._runs.get(run_id)
            if st is None:
                return
            st.status = status
            for q in st.subscribers:
                q.put_nowait(_SENTINEL)
            st.subscribers.clear()

    # --- emit / subscribe ----------------------------------------------
    async def emit(self, run_id: str, event: SseEvent) -> None:
        async with self._lock:
            self._evict_locked()
            st = self._runs.get(run_id)
            if st is None:
                return
            st.events.append(event)
            for q in st.subscribers:
                q.put_nowait(event)

    async def subscribe(self, run_id: str) -> AsyncIterator[SseEvent]:
        """Yield the run's full replay buffer then tail live events.

        Stops on end-of-stream sentinel or if the run isn't registered.
        """
        q: asyncio.Queue = asyncio.Queue()
        replay: list[SseEvent]
        async with self._lock:
            st = self._runs.get(run_id)
            if st is None:
                return
            replay = list(st.events)
            terminal = st.status != "running"
            if not terminal:
                st.subscribers.append(q)
        for ev in replay:
            yield ev
        if terminal:
            return
        try:
            while True:
                item = await q.get()
                if item is _SENTINEL:
                    return
                yield item
        finally:
            async with self._lock:
                st = self._runs.get(run_id)
                if st is not None and q in st.subscribers:
                    st.subscribers.remove(q)

    # --- eviction ------------------------------------------------------
    def _evict_locked(self) -> None:
        now = time.monotonic()
        # (a) drop by age
        while self._order:
            oldest = self._order[0]
            st = self._runs.get(oldest)
            if st is None:
                self._order.popleft()
                continue
            if now - st.created_at > self._max_age_seconds:
                self._drop_locked(oldest)
                continue
            break
        # (b) drop by count
        while len(self._runs) > self._max_runs and self._order:
            self._drop_locked(self._order[0])

    def _drop_locked(self, run_id: str) -> None:
        self._order.popleft() if self._order and self._order[0] == run_id else None
        st = self._runs.pop(run_id, None)
        if st is None:
            return
        # Signal any lingering subscribers then drop.
        for q in st.subscribers:
            q.put_nowait(_SENTINEL)
        st.subscribers.clear()
        if st.decision_id is not None:
            self._decision_index.pop(st.decision_id, None)
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_runtime.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/api/runtime.py backend/api/tests/test_runtime.py
git commit -m "feat(api): PipelineRuntime with replay buffer + fan-out"
```

---

## Task 4: Wire optional on_event callback into investigation + decision agents

**Files:**
- Modify: `backend/agents/investigation/agent.py` — add `on_event` kwarg + emit signal.completed
- Modify: `backend/agents/decision/agent.py` — add `on_event` kwarg + emit action.proposed / action.impact_computed
- Modify: `backend/agents/investigation/tests/test_agent.py` (if exists) or add small test in `backend/agents/investigation/tests/test_on_event.py`
- Create: `backend/agents/decision/tests/test_on_event.py`

- [ ] **Step 1: Write failing tests**

Create `backend/agents/decision/tests/test_on_event.py`:

```python
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
```

Create `backend/agents/investigation/tests/test_on_event.py`:

```python
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
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest agents/decision/tests/test_on_event.py agents/investigation/tests/test_on_event.py -v`
Expected: FAIL — `invoke_decision()`/`invoke_investigation()` don't accept `on_event`.

- [ ] **Step 3: Update `agents/decision/agent.py`**

Modify `invoke_decision` signature and `_run_pipeline` signature to accept `on_event`. Inside `_run_pipeline`, emit `action.proposed` for each action right after `DecisionResult.model_validate(raw)`, and emit `action.impact_computed` after each impact SQL execution.

Replace the current `invoke_decision`:

```python
from typing import Any, Callable

async def invoke_decision(
    inv: InvestigationResult,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> DecisionResult:
    """Run the Decision Agent, orchestrate impact SQL, persist audit row."""
    try:
        return await asyncio.wait_for(
            _run_pipeline(inv, on_event=on_event),
            timeout=DECISION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as e:
        raise DecisionTimeout(
            f"Decision exceeded {DECISION_TIMEOUT_SECONDS:.0f}s"
        ) from e
```

Replace `_run_pipeline` signature:

```python
async def _run_pipeline(
    inv: InvestigationResult,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> DecisionResult:
```

Right after `proposed = DecisionResult.model_validate(raw)` and BEFORE the rendered-SQL loop, add:

```python
    if on_event is not None:
        for a in proposed.actions:
            on_event({
                "type": "action.proposed",
                "data": {"action_type": a.action_type, "priority": a.priority},
            })
```

Inside the impact loop `for (action, _), impact in zip(rendered, impacts):`, at the end of the loop body, add:

```python
        if on_event is not None:
            on_event({
                "type": "action.impact_computed",
                "data": {
                    "action_type": action.action_type,
                    "impact_usd": action.impact_usd,
                    "impact_error": action.impact_error or None,
                },
            })
```

- [ ] **Step 4: Update `agents/investigation/agent.py`**

Add same-shaped `on_event` kwarg to `invoke_investigation` and `_run_pipeline`.

In `_run_pipeline`, after the `async for event in runner.run_async(...)` loop finishes (the loop already tracks per-sub-agent latency), before assembling `findings`, iterate the reloaded state and emit `signal.completed` per finding. Concretely, replace the block that builds `findings`:

```python
    findings = []
    for name in _FINDING_NAMES:
        f = _parse_finding_from_state(state, name)
        f.latency_ms = per_agent_latency.get(name, 0)
        findings.append(f)
        if on_event is not None:
            on_event({
                "type": "signal.completed",
                "data": {
                    "signal": f.signal,
                    "sql": f.sql,
                    "row_count": len(f.rows),
                },
            })
```

Update `invoke_investigation` signature to forward:

```python
async def invoke_investigation(
    detection: DetectionIn,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> InvestigationResult:
    ...
    return await asyncio.wait_for(
        _run_pipeline(detection, on_event=on_event),
        timeout=INVESTIGATION_TIMEOUT_SECONDS,
    )
```

Add `from typing import Callable` (and `Any` if not already imported).

- [ ] **Step 5: Run agent unit tests + verify they pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest agents/decision/tests/test_on_event.py agents/investigation/tests/test_on_event.py -v`
Expected: 4 passed.

- [ ] **Step 6: Regression check — Layer 3b acceptance still 9/9**

Run: `cd backend && PYTHONPATH=. ./venv/bin/python -m agents.decision.acceptance`
Expected: `All Layer 3b acceptance checks PASSED.` (9/9).

If fails: the on_event addition broke something. Investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add backend/agents/decision/agent.py backend/agents/investigation/agent.py \
        backend/agents/decision/tests/test_on_event.py \
        backend/agents/investigation/tests/test_on_event.py
git commit -m "feat(agents): optional on_event callback for SSE sub-agent events"
```

---

## Task 5: Detection sourcing helper

**Files:**
- Create: `backend/api/detection_source.py`
- Create: `backend/api/tests/test_detection_source.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_detection_source.py`:

```python
"""Unit tests for the DetectionIn producer used by the pipeline.

Uses mocked ClickHouse client + mocked refresh_detections — no live queries."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from agents.investigation.contracts import DetectionIn
from api.detection_source import synth_from_crisis, produce_detection
from data.ground_truth import Crisis, CrisisType


def _crisis() -> Crisis:
    return Crisis(
        injection_timestamp=datetime.now(timezone.utc).replace(microsecond=0),
        is_live=True,
        type=CrisisType.REGIONAL_SENTIMENT_COLLAPSE,
        affected_film_id=42,
        affected_region="Brazil",
        magnitude=8.5,
        affected_tables=["audience_sentiment"],
        true_root_cause="synthetic",
        expected_recommendation="issue_pr_statement",
        resolution_window_hours=24,
    )


def test_synth_maps_sentiment_collapse_to_sentiment_metric():
    d = synth_from_crisis(_crisis())
    assert isinstance(d, DetectionIn)
    assert d.film_id == 42
    assert d.region == "Brazil"
    assert d.metric.startswith("audience_sentiment")
    assert d.severity == 8.5
    assert d.dedup_key.startswith(d.metric)


def test_synth_maps_all_crisis_types():
    """Every CrisisType must map to a metric — no KeyError."""
    for ctype in CrisisType:
        c = _crisis()
        c.type = ctype
        d = synth_from_crisis(c)
        assert d.metric  # non-empty


@pytest.mark.asyncio
async def test_produce_detection_uses_refresh_when_row_found():
    """If refresh + select yields a row, produce_detection uses it."""
    crisis = _crisis()
    fake_row = {
        "metric_ts": datetime.now(timezone.utc),
        "metric": "audience_sentiment.avg_score",
        "film_id": 42,
        "region": "Brazil",
        "detector": "zscore",
        "baseline_value": 0.5,
        "actual_value": 0.1,
        "magnitude": 8.5,
        "business_impact": 100.0,
        "severity": 8.5,
        "dedup_key": "audience_sentiment.avg_score|42|Brazil|...|zscore",
    }
    with patch("api.detection_source.refresh_detections",
               new=lambda *a, **kw: 1), \
         patch("api.detection_source._select_matching_row",
               new=AsyncMock(return_value=fake_row)):
        det, source = await produce_detection(crisis, poll_seconds=0.5)
    assert source == "refresh"
    assert det.film_id == 42


@pytest.mark.asyncio
async def test_produce_detection_falls_back_when_row_missing():
    """If select returns None within poll window, we synthesize."""
    crisis = _crisis()
    with patch("api.detection_source.refresh_detections",
               new=lambda *a, **kw: 0), \
         patch("api.detection_source._select_matching_row",
               new=AsyncMock(return_value=None)):
        det, source = await produce_detection(crisis, poll_seconds=0.1)
    assert source == "fallback_synth"
    assert det.film_id == 42
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_detection_source.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement detection_source.py**

Create `backend/api/detection_source.py`:

```python
"""Produce a DetectionIn for the pipeline, post-injection.

Path:
  1. inject_now(...) has already run and returned a Crisis.
  2. refresh_detections(since_hours=6) — recomputes detector output.
  3. SELECT the freshest matching row.
  4. If found within poll_seconds → build DetectionIn from row.
  5. Else → synthesize DetectionIn from the Crisis directly (fallback path).
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Literal

from agents.investigation.contracts import DetectionIn
from data.ch_client import client
from data.ground_truth import Crisis, CrisisType
from data.mv.refresh import refresh_detections


# Canonical metric name for each CrisisType. Mapping is best-guess; the
# detector produces rows against these metric names, so the SELECT below
# looks for a match. If none is found in the poll window we synth anyway.
_CRISIS_METRIC: dict[CrisisType, str] = {
    CrisisType.REGIONAL_SENTIMENT_COLLAPSE:      "audience_sentiment.avg_score",
    CrisisType.TRAILER_VARIANT_UNDERPERFORMANCE: "trailer_analytics.completion_rate",
    CrisisType.COMPETITOR_RELEASE_IMPACT:        "box_office_revenue.revenue_usd",
    CrisisType.MARKETING_OVERSPEND_LOW_ROI:      "campaign_performance.roi",
    CrisisType.STREAMING_COMPLETION_DROP:        "streaming_watch_minutes.completion_rate",
    CrisisType.REFUND_SPIKE:                     "ticket_refunds.refund_rate",
    CrisisType.NEGATIVE_SOCIAL_VIRALITY:         "social_trends.avg_virality",
    CrisisType.REVIEW_SCORE_DIVERGENCE:          "review_scores.avg_score",
}


def synth_from_crisis(crisis: Crisis) -> DetectionIn:
    """Build a DetectionIn directly from a Crisis object (fallback path)."""
    metric = _CRISIS_METRIC.get(crisis.type, "unknown.metric")
    ts = crisis.injection_timestamp
    return DetectionIn(
        metric_ts=ts,
        metric=metric,
        film_id=crisis.affected_film_id,
        region=crisis.affected_region,
        detector="synth",
        baseline_value=0.0,
        actual_value=float(crisis.magnitude),
        magnitude=float(crisis.magnitude),
        business_impact=float(crisis.magnitude),
        severity=float(crisis.magnitude),
        dedup_key=(
            f"{metric}|{crisis.affected_film_id}|{crisis.affected_region}|"
            f"{ts.isoformat(timespec='seconds')}|synth"
        ),
    )


async def _select_matching_row(
    film_id: int, region: str, since_ts: datetime,
) -> dict[str, Any] | None:
    """One-shot SELECT for the freshest matching detection row.

    Runs in a thread — clickhouse-connect is sync. Returns None on 0 rows."""
    def _run() -> list[list[Any]]:
        sql = (
            "SELECT metric_ts, metric, film_id, region, detector, "
            "baseline_value, actual_value, magnitude, business_impact, "
            "severity, dedup_key "
            "FROM detections "
            f"WHERE film_id = {int(film_id)} "
            f"AND region = '{region}' "
            f"AND metric_ts >= toDateTime('{since_ts.strftime('%Y-%m-%d %H:%M:%S')}') "
            "ORDER BY metric_ts DESC LIMIT 1"
        )
        with client() as c:
            return [list(r) for r in c.query(sql).result_rows]
    rows = await asyncio.to_thread(_run)
    if not rows:
        return None
    r = rows[0]
    return {
        "metric_ts": r[0], "metric": r[1], "film_id": r[2], "region": r[3],
        "detector": r[4], "baseline_value": r[5], "actual_value": r[6],
        "magnitude": r[7], "business_impact": r[8], "severity": r[9],
        "dedup_key": r[10],
    }


async def produce_detection(
    crisis: Crisis, *, poll_seconds: float = 2.0,
) -> tuple[DetectionIn, Literal["refresh", "fallback_synth"]]:
    """Refresh + SELECT with poll timeout, else synth from Crisis."""
    # Refresh is cheap (<1s); run in a thread since it's sync.
    await asyncio.to_thread(refresh_detections, 6)
    since = crisis.injection_timestamp - _one_hour()
    deadline = time.monotonic() + poll_seconds
    while time.monotonic() < deadline:
        row = await _select_matching_row(
            crisis.affected_film_id, crisis.affected_region, since,
        )
        if row is not None:
            return DetectionIn(**row), "refresh"
        await asyncio.sleep(0.2)
    return synth_from_crisis(crisis), "fallback_synth"


def _one_hour():
    from datetime import timedelta
    return timedelta(hours=1)
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_detection_source.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/api/detection_source.py backend/api/tests/test_detection_source.py
git commit -m "feat(api): detection sourcing (refresh + select, synth fallback)"
```

---

## Task 6: run_pipeline live path

**Files:**
- Create: `backend/api/pipeline.py`
- Create: `backend/api/tests/test_pipeline_live.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/api/tests/test_pipeline_live.py`:

```python
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
                      "data": {"signal": sig, "sql": "x", "row_count": 0}})
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_pipeline_live.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pipeline.py**

Create `backend/api/pipeline.py`:

```python
"""run_pipeline — the background coroutine that drives one investigation.

Live path emits:
  pipeline.started
  detection.started, detection.completed
  investigation.started, signal.completed x4, investigation.completed
  decision.started, action.proposed x1-3, action.impact_computed x1-3,
    decision.completed
  report.started, report.completed
  pipeline.completed

On any exception, swaps to fallback (via api.fallback.replay_cached_triple)
and emits mode=fallback events. Fallback wiring is added in Task 8.
"""
from __future__ import annotations

import time
from typing import Any

from agents.decision.agent import invoke_decision
from agents.investigation.agent import invoke_investigation
from agents.report.agent import invoke_report
from api.detection_source import produce_detection
from api.events import SseEvent
from api.runtime import PipelineRuntime
from data.crisis_injector import inject_now


async def run_pipeline(
    runtime: PipelineRuntime,
    run_id: str,
    request: dict[str, Any],
    *,
    force_fallback: bool = False,
) -> None:
    """Execute one full pipeline for `run_id`, emitting events into runtime.

    request keys (all optional):
      ctype, film_id, region, magnitude
    """
    t0 = time.perf_counter()
    seq = _SeqGen()

    async def emit(type_: str, data: dict[str, Any]) -> None:
        await runtime.emit(run_id, SseEvent(seq=seq.next(), type=type_, data=data))

    def sync_emit(payload: dict[str, Any]) -> None:
        """Sub-agent callback: schedule an emit without blocking the LLM path."""
        # asyncio.get_running_loop() is safe: run_pipeline is always awaited.
        import asyncio
        asyncio.create_task(emit(payload["type"], payload["data"]))

    try:
        state = await runtime.get(run_id)
        mode = state.mode if state else "live"
        await emit("pipeline.started",
                   {"run_id": run_id, "mode": mode, "requested": request})

        # --- Detection ---
        await emit("detection.started", {})
        crisis = inject_now(
            ctype=request.get("ctype"),
            film_id=request.get("film_id"),
            region=request.get("region"),
            magnitude=request.get("magnitude"),
        )
        det, det_source = await produce_detection(crisis, poll_seconds=2.0)
        await emit("detection.completed",
                   {"detection": det.model_dump(mode="json"),
                    "source": det_source})

        # --- Investigation ---
        await emit("investigation.started", {})
        inv = await invoke_investigation(det, on_event=sync_emit)
        await emit("investigation.completed",
                   {"investigation": inv.model_dump(mode="json")})

        # --- Decision ---
        await emit("decision.started", {})
        dec = await invoke_decision(inv, on_event=sync_emit)
        await runtime.set_decision_id(run_id, dec.decision_id)
        await emit("decision.completed",
                   {"decision": dec.model_dump(mode="json"),
                    "status": dec.status,
                    "threshold_usd": dec.threshold_usd})

        # --- Report ---
        await emit("report.started", {})
        report = await invoke_report(inv, dec)
        await emit("report.completed",
                   {"report": report.model_dump(mode="json")})

        latency_ms = int((time.perf_counter() - t0) * 1000)
        await emit("pipeline.completed",
                   {"run_id": run_id, "latency_ms": latency_ms, "mode": mode})
        await runtime.mark_terminal(run_id, "completed")

    except Exception as e:  # noqa: BLE001 - fallback handling added in Task 8
        await emit("pipeline.failed",
                   {"error": f"{type(e).__name__}: {e}",
                    "stage": _infer_stage(seq.current, e)})
        await runtime.mark_terminal(run_id, "failed")
        raise


class _SeqGen:
    def __init__(self) -> None:
        self._n = -1

    @property
    def current(self) -> int:
        return self._n

    def next(self) -> int:
        self._n += 1
        return self._n


def _infer_stage(current_seq: int, exc: Exception) -> str:
    # Rough mapping from exception class → stage; refined in Task 8 when we
    # care about the fallback path. For now, "unknown" is fine.
    return type(exc).__name__
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_pipeline_live.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/api/pipeline.py backend/api/tests/test_pipeline_live.py
git commit -m "feat(api): run_pipeline live path with SSE event emission"
```

---

## Task 7: Fallback triple loader + replay

**Files:**
- Create: `backend/api/fallback.py`
- Create: `backend/api/tests/test_fallback.py`
- Create: `backend/api/cached/fallback_triple.json` (temporary skeleton — regenerated in Task 13)

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_fallback.py`:

```python
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
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_fallback.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fallback.py**

Create `backend/api/fallback.py`:

```python
"""Cached-triple loader + paced replayer for demo-safety mode.

The cached triple was captured by a real pipeline run (see
api/tests/regenerate_fallback.py). We load once at startup and replay
its stage artifacts with realistic pacing when the live path fails.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from agents.decision.contracts import DecisionResult
from agents.investigation.contracts import DetectionIn, InvestigationResult
from agents.report.contracts import ExecutiveReport
from api.events import SseEvent
from api.runtime import PipelineRuntime


CACHED_TRIPLE_PATH = Path(__file__).parent / "cached" / "fallback_triple.json"


@dataclass(slots=True)
class CachedTriple:
    detection: DetectionIn
    investigation: InvestigationResult
    decision: DecisionResult
    report: ExecutiveReport
    captured_at: datetime
    source_run_id: str


def load_cached_triple(path: Path = CACHED_TRIPLE_PATH) -> CachedTriple:
    """Read + model-validate the on-disk cached triple. Fails loud."""
    raw = json.loads(Path(path).read_text())
    return CachedTriple(
        detection=DetectionIn.model_validate(raw["detection"]),
        investigation=InvestigationResult.model_validate(raw["investigation"]),
        decision=DecisionResult.model_validate(raw["decision"]),
        report=ExecutiveReport.model_validate(raw["report"]),
        captured_at=datetime.fromisoformat(raw["captured_at"]),
        source_run_id=raw["source_run_id"],
    )


# Pacing: seconds to sleep BEFORE each event to simulate live-ish tempo.
_PACING: dict[str, float] = {
    "detection.started": 0.0,
    "detection.completed": 0.5,
    "investigation.started": 0.0,
    "signal.completed": 1.0,
    "investigation.completed": 0.5,
    "decision.started": 0.0,
    "action.proposed": 0.2,
    "action.impact_computed": 0.4,
    "decision.completed": 0.3,
    "report.started": 0.0,
    "report.completed": 1.5,
    "pipeline.completed": 0.0,
}


async def replay_cached_triple(
    runtime: PipelineRuntime,
    run_id: str,
    triple: CachedTriple,
    *,
    pacing_scale: float = 1.0,
) -> None:
    """Emit all stage events from the cached triple with paced sleeps.

    pacing_scale=0 disables sleeps (used by unit tests)."""
    seq = _Seq()

    async def emit(type_: str, data: dict) -> None:
        await asyncio.sleep(_PACING.get(type_, 0.0) * pacing_scale)
        data = {**data, "mode": "fallback"}
        await runtime.emit(run_id,
                           SseEvent(seq=seq.next(), type=type_, data=data))

    await emit("detection.started", {"source": "cached"})
    await emit("detection.completed",
               {"detection": triple.detection.model_dump(mode="json"),
                "source": "cached"})
    await emit("investigation.started", {})
    for f in triple.investigation.findings:
        await emit("signal.completed",
                   {"signal": f.signal, "sql": f.sql, "row_count": len(f.rows)})
    await emit("investigation.completed",
               {"investigation": triple.investigation.model_dump(mode="json")})
    await emit("decision.started", {})
    for a in triple.decision.actions:
        await emit("action.proposed",
                   {"action_type": a.action_type, "priority": a.priority})
    for a in triple.decision.actions:
        await emit("action.impact_computed",
                   {"action_type": a.action_type,
                    "impact_usd": a.impact_usd,
                    "impact_error": a.impact_error or None})
    await emit("decision.completed",
               {"decision": triple.decision.model_dump(mode="json"),
                "status": triple.decision.status,
                "threshold_usd": triple.decision.threshold_usd})
    await emit("report.started", {})
    await emit("report.completed",
               {"report": triple.report.model_dump(mode="json")})
    await emit("pipeline.completed",
               {"run_id": run_id, "latency_ms": 0, "mode": "fallback"})


class _Seq:
    def __init__(self) -> None:
        self._n = -1

    def next(self) -> int:
        self._n += 1
        return self._n
```

- [ ] **Step 4: Create skeleton cached triple**

For tests, we need a placeholder cached triple. Regenerate script runs later (Task 13). For now, write a minimal placeholder that will fail load until real:

```bash
cat > backend/api/cached/fallback_triple.json << 'EOF'
{
  "_placeholder": true,
  "note": "This file will be overwritten by api/tests/regenerate_fallback.py in Task 13."
}
EOF
```

The unit test uses `tmp_path` so it doesn't depend on this file being valid.

- [ ] **Step 5: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_fallback.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/api/fallback.py backend/api/tests/test_fallback.py \
        backend/api/cached/fallback_triple.json
git commit -m "feat(api): fallback triple loader + paced replayer"
```

---

## Task 8: Wire fallback trigger into run_pipeline

**Files:**
- Modify: `backend/api/pipeline.py`
- Create: `backend/api/tests/test_pipeline_fallback.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_pipeline_fallback.py`:

```python
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
         patch("api.pipeline._pacing_scale", 0.0):
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
         patch("api.pipeline._pacing_scale", 0.0):
        await run_pipeline(rt, "r1", request={}, force_fallback=True)
    st = await rt.get("r1")
    assert st.mode == "fallback"
    assert st.status == "completed"
```

- [ ] **Step 2: Modify pipeline.py to add fallback handling**

Prepend at the top of `backend/api/pipeline.py` (after imports):

```python
from api.fallback import CachedTriple, replay_cached_triple

# Populated by api.main at startup. Unit tests patch this directly.
_cached_triple: CachedTriple | None = None
_pacing_scale: float = 1.0


def install_cached_triple(triple: CachedTriple, *, pacing_scale: float = 1.0) -> None:
    """Called by api.main startup once per process."""
    global _cached_triple, _pacing_scale
    _cached_triple = triple
    _pacing_scale = pacing_scale
```

Replace `run_pipeline` — add `force_fallback` handling and exception swap:

```python
async def run_pipeline(
    runtime: PipelineRuntime,
    run_id: str,
    request: dict[str, Any],
    *,
    force_fallback: bool = False,
) -> None:
    t0 = time.perf_counter()
    seq = _SeqGen()

    async def emit(type_: str, data: dict[str, Any]) -> None:
        await runtime.emit(run_id, SseEvent(seq=seq.next(), type=type_, data=data))

    def sync_emit(payload: dict[str, Any]) -> None:
        import asyncio
        asyncio.create_task(emit(payload["type"], payload["data"]))

    state = await runtime.get(run_id)
    mode = state.mode if state else "live"
    await emit("pipeline.started",
               {"run_id": run_id, "mode": mode, "requested": request})

    if force_fallback:
        return await _run_fallback(runtime, run_id, "forced")

    try:
        # --- Detection ---
        await emit("detection.started", {})
        crisis = inject_now(
            ctype=request.get("ctype"),
            film_id=request.get("film_id"),
            region=request.get("region"),
            magnitude=request.get("magnitude"),
        )
        det, det_source = await produce_detection(crisis, poll_seconds=2.0)
        await emit("detection.completed",
                   {"detection": det.model_dump(mode="json"),
                    "source": det_source})

        # --- Investigation ---
        await emit("investigation.started", {})
        inv = await invoke_investigation(det, on_event=sync_emit)
        await emit("investigation.completed",
                   {"investigation": inv.model_dump(mode="json")})

        # --- Decision ---
        await emit("decision.started", {})
        dec = await invoke_decision(inv, on_event=sync_emit)
        await runtime.set_decision_id(run_id, dec.decision_id)
        await emit("decision.completed",
                   {"decision": dec.model_dump(mode="json"),
                    "status": dec.status,
                    "threshold_usd": dec.threshold_usd})

        # --- Report ---
        await emit("report.started", {})
        report = await invoke_report(inv, dec)
        await emit("report.completed",
                   {"report": report.model_dump(mode="json")})

        latency_ms = int((time.perf_counter() - t0) * 1000)
        await emit("pipeline.completed",
                   {"run_id": run_id, "latency_ms": latency_ms, "mode": mode})
        await runtime.mark_terminal(run_id, "completed")

    except Exception as e:  # noqa: BLE001
        await emit("pipeline.failed",
                   {"error": f"{type(e).__name__}: {e}",
                    "stage": _infer_stage(seq.current, e)})
        await _run_fallback(runtime, run_id, f"{type(e).__name__}")


async def _run_fallback(
    runtime: PipelineRuntime, run_id: str, reason: str,
) -> None:
    """Swap to fallback mode and replay the cached triple."""
    if _cached_triple is None:
        # No cached triple installed — mark failed and give up. Only happens
        # in tests that forgot to patch _cached_triple, or in a broken deploy.
        await runtime.mark_terminal(run_id, "failed")
        return
    await runtime.mark_mode(run_id, "fallback")
    await runtime.set_decision_id(run_id, _cached_triple.decision.decision_id)
    await replay_cached_triple(
        runtime, run_id, _cached_triple, pacing_scale=_pacing_scale,
    )
    await runtime.mark_terminal(run_id, "completed")
```

- [ ] **Step 3: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_pipeline_live.py api/tests/test_pipeline_fallback.py -v`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/api/pipeline.py backend/api/tests/test_pipeline_fallback.py
git commit -m "feat(api): fallback triple swap on pipeline exception + force flag"
```

---

## Task 9: FastAPI app skeleton

**Files:**
- Create: `backend/api/main.py`
- Create: `backend/api/tests/test_main_startup.py`

- [ ] **Step 1: Write failing test**

Create `backend/api/tests/test_main_startup.py`:

```python
"""App boots + healthcheck endpoint returns OK + runtime is installed."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def test_healthcheck(tmp_path, monkeypatch):
    # Bypass the cached-triple load-on-startup for unit tests.
    from api.tests.test_fallback import _mk_triple

    def _fake_loader(path=None):
        return _mk_triple()

    with patch("api.main.load_cached_triple", side_effect=_fake_loader):
        from api.main import app
        with TestClient(app) as client:
            r = client.get("/healthz")
            assert r.status_code == 200
            assert r.json() == {"status": "ok"}
```

- [ ] **Step 2: Run failing test**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_main_startup.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement main.py**

Create `backend/api/main.py`:

```python
"""FastAPI app entrypoint.

Startup:
  1. Load cached fallback triple (fail loud if missing).
  2. Instantiate PipelineRuntime.
  3. install_cached_triple(...) so api.pipeline can swap on exception.
  4. Mount routers.

The app object is imported by uvicorn: `uvicorn api.main:app`.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.fallback import load_cached_triple
from api.pipeline import install_cached_triple
from api.runtime import PipelineRuntime


runtime: PipelineRuntime = PipelineRuntime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    triple = load_cached_triple()
    install_cached_triple(triple)
    app.state.runtime = runtime
    app.state.cached_triple = triple
    yield


app = FastAPI(title="Studio Crisis Commander API", lifespan=lifespan)

_origins = os.getenv("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_main_startup.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/api/main.py backend/api/tests/test_main_startup.py
git commit -m "feat(api): FastAPI app skeleton with lifespan-loaded fallback"
```

---

## Task 10: POST /inject-crisis + GET /stream/{run_id}

**Files:**
- Create: `backend/api/routers/inject.py`
- Create: `backend/api/routers/stream.py`
- Modify: `backend/api/main.py` — mount routers
- Create: `backend/api/tests/test_routers_inject_and_stream.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_routers_inject_and_stream.py`:

```python
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
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_routers_inject_and_stream.py -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement routers/inject.py**

Create `backend/api/routers/inject.py`:

```python
"""POST /inject-crisis — kick off a new pipeline run."""
from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from api.pipeline import run_pipeline


router = APIRouter(tags=["pipeline"])


class InjectRequest(BaseModel):
    ctype: str | None = None
    film_id: int | None = None
    region: str | None = None
    magnitude: float | None = None
    fallback: str | None = Field(default=None,
                                 description='"auto" (default) or "force"')


@router.post("/inject-crisis", status_code=202)
async def inject_crisis(req: InjectRequest, request: Request):
    runtime = request.app.state.runtime
    run_id = uuid4().hex
    await runtime.register(run_id)
    asyncio.create_task(run_pipeline(
        runtime, run_id,
        request={"ctype": req.ctype, "film_id": req.film_id,
                 "region": req.region, "magnitude": req.magnitude},
        force_fallback=(req.fallback == "force"),
    ))
    return JSONResponse(
        status_code=202,
        content={
            "run_id": run_id,
            "stream_url": f"/stream/investigation/{run_id}",
        },
    )
```

- [ ] **Step 4: Implement routers/stream.py**

Create `backend/api/routers/stream.py`:

```python
"""GET /stream/investigation/{run_id} — SSE stream of the run's events."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse


router = APIRouter(tags=["pipeline"])


@router.get("/stream/investigation/{run_id}")
async def stream_run(run_id: str, request: Request):
    runtime = request.app.state.runtime
    if (await runtime.get(run_id)) is None:
        raise HTTPException(status_code=404, detail=f"unknown run_id: {run_id}")

    async def _gen():
        # Retry hint for browser EventSource auto-reconnect.
        yield b"retry: 3000\n\n"
        async for ev in runtime.subscribe(run_id):
            yield ev.serialize()

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
```

- [ ] **Step 5: Mount routers in main.py**

Edit `backend/api/main.py` — add the two router mounts:

```python
from api.routers import inject as inject_router
from api.routers import stream as stream_router

# ... existing app + middleware setup ...

app.include_router(inject_router.router)
app.include_router(stream_router.router)
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_routers_inject_and_stream.py -v`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/api/routers/inject.py backend/api/routers/stream.py \
        backend/api/main.py backend/api/tests/test_routers_inject_and_stream.py
git commit -m "feat(api): POST /inject-crisis and GET /stream/investigation/{run_id}"
```

---

## Task 11: GET /detections + GET /audit + POST /approve + POST /deny

**Files:**
- Create: `backend/api/routers/detections.py`
- Create: `backend/api/routers/audit.py`
- Modify: `backend/api/main.py` — mount routers
- Create: `backend/api/tests/test_routers_detections.py`
- Create: `backend/api/tests/test_routers_audit.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_routers_detections.py`:

```python
"""GET /detections shape test with mocked ClickHouse client."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def test_detections_returns_shape(monkeypatch):
    from api.tests.test_fallback import _mk_triple
    fake_rows = [
        ("2026-08-09 12:00:00", "x.y", 1, "Brazil",
         "zscore", 0.0, 1.0, 5.0, 1000.0, 5.0, "k1"),
    ]

    class FakeCH:
        def query(self, sql):
            m = MagicMock()
            m.result_rows = fake_rows
            return m
        def __enter__(self): return self
        def __exit__(self, *a): return False

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.detections.client", return_value=FakeCH()):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/detections?limit=5&since_hours=24")
            assert r.status_code == 200
            body = r.json()
            assert "detections" in body
            assert "query_latency_ms" in body
            assert body["detections"][0]["metric"] == "x.y"
```

Create `backend/api/tests/test_routers_audit.py`:

```python
"""GET /audit + POST /approve + POST /deny (with mocked audit facade)."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from agents.decision.audit import AuditRow
from agents.decision.contracts import DecisionResult, RecommendedAction


def _row(status="pending_approval") -> AuditRow:
    dec = DecisionResult(
        decision_id="dec-1", investigation_id="inv-1",
        actions=[RecommendedAction(
            action_type="issue_pr_statement",
            rationale="stakeholders need clarity",
            params={"film_id": 1, "region": "Brazil", "message_theme": "t"},
            impact_usd=1000.0, impact_sql="SELECT 1000", priority=1,
        )],
        status="pending_approval", threshold_usd=5000.0,
        created_at=datetime.now(timezone.utc),
    )
    return AuditRow(
        decision_id="dec-1", investigation_id="inv-1",
        detection_dedup_key="k", film_id=1, region="Brazil",
        actions=list(dec.actions), status=dec.status,
        threshold_usd=5000.0, agent_run=dec, report=None,
        approval_status=status, approver="", approval_note="",
        approved_at=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def test_audit_list_returns_rows():
    from api.tests.test_fallback import _mk_triple
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.audit.list_recent_audit", return_value=[_row()]):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/audit")
            assert r.status_code == 200
            body = r.json()
            assert len(body) == 1
            assert body[0]["decision_id"] == "dec-1"


def test_approve_calls_facade():
    from api.tests.test_fallback import _mk_triple
    approved = _row(status="approved")
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.audit.async_approve_decision",
               new=AsyncMock(return_value=approved)):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.post("/approve/dec-1",
                        json={"approver": "alice", "note": "ok"})
            assert r.status_code == 200
            body = r.json()
            assert body["approval_status"] == "approved"


def test_deny_calls_facade():
    from api.tests.test_fallback import _mk_triple
    denied = _row(status="denied")
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.audit.deny_decision", return_value=denied):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.post("/deny/dec-1",
                        json={"approver": "bob", "note": "nope"})
            assert r.status_code == 200
            body = r.json()
            assert body["approval_status"] == "denied"
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_routers_detections.py api/tests/test_routers_audit.py -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement routers/detections.py**

Create `backend/api/routers/detections.py`:

```python
"""GET /detections — recent detection rows for the anomaly feed."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query

from data.ch_client import client


router = APIRouter(tags=["reads"])

_COLS = ("metric_ts", "metric", "film_id", "region",
         "detector", "baseline_value", "actual_value",
         "magnitude", "business_impact", "severity", "dedup_key")


@router.get("/detections")
async def detections(
    limit: int = Query(50, ge=1, le=500),
    since_hours: int = Query(24, ge=1, le=168),
):
    def _run() -> list[list]:
        sql = (
            f"SELECT toString(metric_ts), metric, film_id, region, "
            f"detector, baseline_value, actual_value, magnitude, "
            f"business_impact, severity, dedup_key "
            f"FROM detections "
            f"WHERE metric_ts >= now() - INTERVAL {int(since_hours)} HOUR "
            f"ORDER BY severity DESC LIMIT {int(limit)}"
        )
        with client() as c:
            return [list(r) for r in c.query(sql).result_rows]
    t0 = time.perf_counter()
    rows = await asyncio.to_thread(_run)
    dt_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "detections": [dict(zip(_COLS, r)) for r in rows],
        "query_latency_ms": dt_ms,
    }
```

- [ ] **Step 4: Implement routers/audit.py**

Create `backend/api/routers/audit.py`:

```python
"""GET /audit + POST /approve/{id} + POST /deny/{id}."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from agents.decision.audit import (
    AuditRow, async_approve_decision, deny_decision, list_recent_audit,
)
from api.events import SseEvent


router = APIRouter(tags=["audit"])


class ApprovalRequest(BaseModel):
    approver: str
    note: str = ""


@router.get("/audit", response_model=list[AuditRow])
def audit_list(limit: int = 50):
    return list_recent_audit(limit=limit)


@router.post("/approve/{decision_id}", response_model=AuditRow)
async def approve(decision_id: str, req: ApprovalRequest, request: Request):
    try:
        row = await async_approve_decision(decision_id, req.approver, req.note)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await _echo(request, decision_id, "approval.granted", req)
    return row


@router.post("/deny/{decision_id}", response_model=AuditRow)
async def deny(decision_id: str, req: ApprovalRequest, request: Request):
    try:
        row = deny_decision(decision_id, req.approver, req.note)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await _echo(request, decision_id, "approval.denied", req)
    return row


async def _echo(request: Request, decision_id: str, ev_type: str,
                req: ApprovalRequest) -> None:
    """Best-effort push of approval event onto any still-live SSE stream."""
    runtime = request.app.state.runtime
    run_id = await runtime.run_id_for_decision(decision_id)
    if run_id is None:
        return
    st = await runtime.get(run_id)
    if st is None or st.status != "running":
        # Post-terminal decision: audit is durable, no live stream to echo to.
        return
    seq = len(st.events)
    await runtime.emit(run_id, SseEvent(
        seq=seq, type=ev_type,
        data={"decision_id": decision_id,
              "approver": req.approver, "note": req.note},
    ))
```

- [ ] **Step 5: Mount in main.py**

Add to `backend/api/main.py`:

```python
from api.routers import detections as detections_router
from api.routers import audit as audit_router

app.include_router(detections_router.router)
app.include_router(audit_router.router)
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_routers_detections.py api/tests/test_routers_audit.py -v`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/api/routers/detections.py backend/api/routers/audit.py \
        backend/api/main.py backend/api/tests/test_routers_detections.py \
        backend/api/tests/test_routers_audit.py
git commit -m "feat(api): /detections, /audit, /approve, /deny endpoints"
```

---

## Task 12: GET /metrics/{film_id}/{region}

**Files:**
- Create: `backend/api/routers/metrics.py`
- Modify: `backend/api/main.py` — mount router
- Create: `backend/api/tests/test_routers_metrics.py`

- [ ] **Step 1: Write failing tests**

Create `backend/api/tests/test_routers_metrics.py`:

```python
"""GET /metrics/{film}/{region} — 4 parallel timeseries + latency badge."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def test_metrics_returns_all_four_series():
    from api.tests.test_fallback import _mk_triple

    def _fake_client_factory():
        class FakeCH:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def query(self, sql):
                m = MagicMock()
                m.result_rows = [("2026-08-09 12:00:00", 1000, 100)]
                return m
        return FakeCH()

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.metrics.client", side_effect=_fake_client_factory):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/metrics/1/Brazil?hours=48")
            assert r.status_code == 200
            body = r.json()
            assert body["film_id"] == 1
            assert body["region"] == "Brazil"
            assert set(body["timeseries"].keys()) == {
                "box_office_daily", "social_virality_hourly",
                "sentiment_hourly", "trailer_hourly",
            }
            assert "query_latency_ms" in body
```

- [ ] **Step 2: Run failing test**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_routers_metrics.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement routers/metrics.py**

Create `backend/api/routers/metrics.py`:

```python
"""GET /metrics/{film_id}/{region} — 4 parallel rollup timeseries."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query

from data.ch_client import client


router = APIRouter(tags=["reads"])


def _q_box_office(film_id: int, region: str, hours: int) -> str:
    days = max(1, hours // 24)
    return (
        f"SELECT toString(date) AS ts, revenue_usd, tickets_sold "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND date >= today() - INTERVAL {days} DAY "
        f"ORDER BY date"
    )


def _q_social(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts, "
        f"sum_virality / greatest(n, 1) AS avg_virality, "
        f"n AS volume "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= now() - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _q_sentiment(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts, "
        f"sum_score_weighted / greatest(sum_volume, 1) AS avg_score, "
        f"sum_volume AS volume "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= now() - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _q_trailer(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts, sum_views AS views, "
        f"sum_completion_x_views / greatest(sum_views, 1) AS completion_rate "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= now() - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _run_query_sync(sql: str, cols: tuple[str, ...]) -> list[dict]:
    with client() as c:
        rows = c.query(sql).result_rows
    return [dict(zip(cols, r)) for r in rows]


async def _run(sql: str, cols: tuple[str, ...]) -> list[dict]:
    return await asyncio.to_thread(_run_query_sync, sql, cols)


@router.get("/metrics/{film_id}/{region}")
async def metrics(
    film_id: int, region: str,
    hours: int = Query(48, ge=1, le=720),
):
    t0 = time.perf_counter()
    box, soc, sent, trail = await asyncio.gather(
        _run(_q_box_office(film_id, region, hours),
             ("ts", "revenue_usd", "tickets_sold")),
        _run(_q_social(film_id, region, hours),
             ("ts", "avg_virality", "volume")),
        _run(_q_sentiment(film_id, region, hours),
             ("ts", "avg_score", "volume")),
        _run(_q_trailer(film_id, region, hours),
             ("ts", "views", "completion_rate")),
    )
    dt_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "film_id": film_id, "region": region, "hours": hours,
        "timeseries": {
            "box_office_daily": box,
            "social_virality_hourly": soc,
            "sentiment_hourly": sent,
            "trailer_hourly": trail,
        },
        "query_latency_ms": dt_ms,
    }
```

- [ ] **Step 4: Mount in main.py**

Add to `backend/api/main.py`:

```python
from api.routers import metrics as metrics_router

app.include_router(metrics_router.router)
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/tests/test_routers_metrics.py -v`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/api/routers/metrics.py backend/api/main.py \
        backend/api/tests/test_routers_metrics.py
git commit -m "feat(api): GET /metrics/{film_id}/{region} chart telemetry"
```

---

## Task 13: Regenerate cached fallback triple

**Files:**
- Create: `backend/api/tests/regenerate_fallback.py`
- Overwrite: `backend/api/cached/fallback_triple.json`

- [ ] **Step 1: Implement the regeneration script**

Create `backend/api/tests/regenerate_fallback.py`:

```python
"""Regenerate api/cached/fallback_triple.json from a real pipeline run.

Runs the FULL live pipeline once on a canonical crisis (sentiment_collapse
on film_id=1, region='Brazil'), captures the four artifacts, writes JSON.

Cost: ~$0.10 (one Layer 3a + one Layer 3b run).
Rerun only when the DetectionIn / InvestigationResult / DecisionResult /
ExecutiveReport contracts change.

Usage:
    PYTHONPATH=. ./venv/bin/python -m api.tests.regenerate_fallback
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from agents.decision.agent import invoke_decision
from agents.investigation.agent import invoke_investigation
from agents.report.agent import invoke_report
from api.detection_source import produce_detection
from api.fallback import CACHED_TRIPLE_PATH
from data.crisis_injector import inject_now
from data.ground_truth import CrisisType


CANONICAL = {
    "ctype": CrisisType.REGIONAL_SENTIMENT_COLLAPSE,
    "film_id": 1,
    "region": "Brazil",
    "magnitude": 8.0,
}


async def main() -> None:
    crisis = inject_now(
        ctype=CANONICAL["ctype"],
        film_id=CANONICAL["film_id"],
        region=CANONICAL["region"],
        magnitude=CANONICAL["magnitude"],
    )
    det, src = await produce_detection(crisis, poll_seconds=2.0)
    print(f"detection ready (source={src}); running investigation...", file=sys.stderr)
    inv = await invoke_investigation(det)
    print(f"investigation done; running decision...", file=sys.stderr)
    dec = await invoke_decision(inv)
    print(f"decision done ({len(dec.actions)} actions); running report...",
          file=sys.stderr)
    report = await invoke_report(inv, dec)
    print(f"report done ({len(report.key_figures)} key_figures); writing...",
          file=sys.stderr)

    payload = {
        "detection": det.model_dump(mode="json"),
        "investigation": inv.model_dump(mode="json"),
        "decision": dec.model_dump(mode="json"),
        "report": report.model_dump(mode="json"),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "source_run_id": "regenerate_fallback",
    }
    Path(CACHED_TRIPLE_PATH).write_text(json.dumps(payload, indent=2, default=str))
    print(f"wrote {CACHED_TRIPLE_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run the regeneration script (LIVE — costs ~$0.10)**

Run: `cd backend && PYTHONPATH=. ./venv/bin/python -m api.tests.regenerate_fallback`
Expected: prints "wrote .../fallback_triple.json"; no exceptions.

- [ ] **Step 3: Verify the generated file loads and validates**

Run: `cd backend && PYTHONPATH=. ./venv/bin/python -c "from api.fallback import load_cached_triple; t = load_cached_triple(); print(f'ok: {t.decision.decision_id}, actions={len(t.decision.actions)}, key_figs={len(t.report.key_figures)}')"`
Expected: prints ok with a decision_id + counts.

- [ ] **Step 4: Commit**

```bash
git add backend/api/tests/regenerate_fallback.py \
        backend/api/cached/fallback_triple.json
git commit -m "chore(api): cached fallback triple + regeneration script"
```

---

## Task 14: Dockerfile

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`

- [ ] **Step 1: Create Dockerfile**

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY api ./api
COPY agents ./agents
COPY data ./data
COPY mcp_integration ./mcp_integration

ENV PYTHONPATH=/app
EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host=0.0.0.0", "--port=8080", "--workers=1"]
```

- [ ] **Step 2: Create .dockerignore**

Create `backend/.dockerignore`:

```
venv
**/__pycache__
**/*.pyc
**/tests
*.log
.env
service-account.json
```

Note: `**/tests` includes the fallback-regen script, but `api/cached/fallback_triple.json` is not under `tests/` and is included.

- [ ] **Step 3: Local smoke — verify uvicorn boots the app**

Run: `cd backend && PYTHONPATH=. ./venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 18080 &`
Then in another shell: `curl -s http://127.0.0.1:18080/healthz` → `{"status":"ok"}`
Then: `pkill -f "uvicorn api.main:app"`

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "chore(api): Dockerfile for Cloud Run"
```

---

## Task 15: Live acceptance sweep

**Files:**
- Create: `backend/api/tests/acceptance.py`

- [ ] **Step 1: Implement the acceptance sweep**

Create `backend/api/tests/acceptance.py`:

```python
"""Layer 4 acceptance sweep — 9 checks. Exit 0 if all pass, 1 otherwise.

  §1 boundary grep       §2 startup + fallback load
  §3 inject+stream taxonomy   §4 audit round-trip
  §5 fallback path       §6 late subscriber
  §7 read endpoints      §8 approval SSE echo
  §9 live e2e under cap

Cost per run: ~$0.20 (§3, §9 each drive one full pipeline; others are
in-memory or read-only). Live checks require the app running.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx


BASE_URL = "http://127.0.0.1:18099"
BOUNDARY_ROOT = Path(__file__).resolve().parents[2]   # backend/


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


# --- §1 -------------------------------------------------------------
def check_1_boundary() -> None:
    """api/ may not import agents' internals — only the public entrypoints."""
    r = subprocess.run(
        ["grep", "-rEln",
         r"^(from agents\.(investigation|decision|report)\.(subagents|prompts|actions|_provenance|acceptance|acceptance_helpers)|"
         r"from agents\.decision\.audit import (_|audit_insert|audit_attach_report|approve_decision(?!_)|_set_approval|_insert_row))",
         "api/", "--include=*.py",
         "--exclude-dir=__pycache__", "--exclude-dir=venv"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n") if p]
    if bad:
        _fail(f"§1 boundary violation — {bad}")
    print("PASS §1: api/ only imports public agent entrypoints")


# --- run app subprocess --------------------------------------------
@asynccontextmanager
async def _running_app():
    """Start uvicorn in a subprocess, poll /healthz, yield, then kill."""
    proc = subprocess.Popen(
        ["./venv/bin/uvicorn", "api.main:app",
         "--host", "127.0.0.1", "--port", "18099"],
        env={**_env(), "PYTHONPATH": "."},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                async with httpx.AsyncClient() as c:
                    r = await c.get(f"{BASE_URL}/healthz", timeout=1.0)
                if r.status_code == 200:
                    break
            except httpx.RequestError:
                pass
            await asyncio.sleep(0.2)
        else:
            _fail("app did not boot within 10s")
        yield
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _env() -> dict:
    import os
    return {k: v for k, v in os.environ.items()}


# --- §2 -------------------------------------------------------------
async def check_2_startup() -> None:
    async with _running_app():
        # If we got here, healthz returned 200 — startup ran (loaded triple + runtime).
        pass
    print("PASS §2: app boots + fallback triple loads")


# --- helpers to consume SSE ----------------------------------------
async def _collect_events(client: httpx.AsyncClient, url: str,
                          until_type: str, max_wait: float = 180.0):
    events: list[dict] = []
    deadline = time.monotonic() + max_wait
    async with client.stream("GET", url, timeout=max_wait) as s:
        async for line in s.aiter_lines():
            if time.monotonic() > deadline:
                _fail(f"SSE stream exceeded {max_wait}s")
            if line.startswith("data: "):
                body = json.loads(line[len("data: "):])
                events.append(body)
                if body["type"] == until_type:
                    return events
    _fail(f"stream closed without receiving {until_type}")


# --- §3 + §9 combined -----------------------------------------------
async def check_3_and_9_inject_and_stream() -> str:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as ac:
            t0 = time.perf_counter()
            r = await ac.post("/inject-crisis", json={})
            if r.status_code != 202:
                _fail(f"§3 POST /inject-crisis returned {r.status_code}")
            run_id = r.json()["run_id"]
            events = await _collect_events(
                ac, f"/stream/investigation/{run_id}",
                until_type="pipeline.completed", max_wait=180.0,
            )
            dt = time.perf_counter() - t0
            types_seen = [e["type"] for e in events]
            assert types_seen.count("detection.completed") == 1, types_seen
            assert types_seen.count("signal.completed") == 4, types_seen
            assert types_seen.count("report.completed") == 1, types_seen
            impact_events = [e for e in events if e["type"] == "action.impact_computed"]
            assert 1 <= len(impact_events) <= 3, f"got {len(impact_events)} impact events"
            print(f"PASS §3: SSE event taxonomy valid "
                  f"({len(events)} events, signals=4, impacts={len(impact_events)})")
            if dt > 180.0:
                _fail(f"§9 live e2e {dt:.1f}s > 180s cap")
            print(f"PASS §9: live e2e {dt:.1f}s under 180s cap")
            # Return the decision_id emitted by decision.completed for §4/§8.
            dec_event = next(e for e in events if e["type"] == "decision.completed")
            return dec_event["data"]["decision"]["decision_id"]
    return ""


# --- §4 -------------------------------------------------------------
async def check_4_audit_roundtrip(decision_id: str) -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as ac:
            r = await ac.get("/audit?limit=100")
            if r.status_code != 200:
                _fail(f"§4 GET /audit returned {r.status_code}")
            audit = r.json()
            if not any(row["decision_id"] == decision_id for row in audit):
                _fail(f"§4 decision_id {decision_id} not found in audit list")
            r = await ac.post(f"/approve/{decision_id}",
                              json={"approver": "acceptance@example",
                                    "note": "auto-approve"})
            if r.status_code != 200:
                _fail(f"§4 /approve returned {r.status_code}: {r.text}")
            body = r.json()
            if body["approval_status"] != "approved":
                _fail(f"§4 approval_status = {body['approval_status']!r}")
    print("PASS §4: audit list contains new row; /approve flips status")


# --- §5 -------------------------------------------------------------
async def check_5_fallback_path() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=60) as ac:
            t0 = time.perf_counter()
            r = await ac.post("/inject-crisis",
                              json={"fallback": "force"})
            if r.status_code != 202:
                _fail(f"§5 POST /inject-crisis?fallback=force returned {r.status_code}")
            run_id = r.json()["run_id"]
            events = await _collect_events(
                ac, f"/stream/investigation/{run_id}",
                until_type="pipeline.completed", max_wait=30.0,
            )
            dt = time.perf_counter() - t0
            if dt > 15.0:
                _fail(f"§5 fallback e2e {dt:.1f}s > 15s (pacing budget)")
            for e in events:
                if e["type"].startswith(("detection.", "investigation.",
                                         "decision.", "report.",
                                         "pipeline.completed", "signal.",
                                         "action.")):
                    if e["data"].get("mode") != "fallback":
                        _fail(f"§5 event {e['type']} missing mode=fallback")
    print(f"PASS §5: fallback path completes in {dt:.1f}s, all events tagged mode=fallback")


# --- §6 -------------------------------------------------------------
async def check_6_late_subscriber() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as ac:
            r = await ac.post("/inject-crisis",
                              json={"fallback": "force"})
            run_id = r.json()["run_id"]
            await asyncio.sleep(2.0)   # let some events accumulate
            events = await _collect_events(
                ac, f"/stream/investigation/{run_id}",
                until_type="pipeline.completed", max_wait=30.0,
            )
            types = [e["type"] for e in events]
            # Late subscriber must still see early events via replay.
            if "detection.started" not in types:
                _fail(f"§6 late subscriber missed detection.started: {types}")
    print(f"PASS §6: late subscriber received full replay ({len(events)} events)")


# --- §7 -------------------------------------------------------------
async def check_7_read_endpoints() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as ac:
            t0 = time.perf_counter()
            r1 = await ac.get("/detections?limit=10")
            t1 = time.perf_counter()
            r2 = await ac.get("/metrics/1/Brazil?hours=48")
            t2 = time.perf_counter()
            if r1.status_code != 200:
                _fail(f"§7 /detections {r1.status_code}")
            if not r1.json()["detections"]:
                _fail("§7 /detections empty")
            if (t1 - t0) > 0.5:
                _fail(f"§7 /detections {t1-t0:.2f}s > 0.5s")
            if r2.status_code != 200:
                _fail(f"§7 /metrics {r2.status_code}")
            keys = set(r2.json()["timeseries"].keys())
            expected = {"box_office_daily", "social_virality_hourly",
                        "sentiment_hourly", "trailer_hourly"}
            if keys != expected:
                _fail(f"§7 /metrics keys {keys} != {expected}")
            if (t2 - t1) > 0.5:
                _fail(f"§7 /metrics {t2-t1:.2f}s > 0.5s")
    print(f"PASS §7: /detections + /metrics respond <500ms with expected shape")


# --- §8 -------------------------------------------------------------
async def check_8_approval_echo() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as ac:
            r = await ac.post("/inject-crisis",
                              json={"fallback": "force"})
            run_id = r.json()["run_id"]
            got_approval = asyncio.Event()
            observed_decision_id = None

            async def consume():
                nonlocal observed_decision_id
                async with ac.stream("GET",
                                     f"/stream/investigation/{run_id}") as s:
                    async for line in s.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        body = json.loads(line[len("data: "):])
                        if body["type"] == "decision.completed":
                            observed_decision_id = body["data"]["decision"]["decision_id"]
                        if body["type"] == "approval.granted":
                            got_approval.set()
                            return
                        if body["type"] == "pipeline.completed":
                            # Fallback runs to completion in ~10s; the stream
                            # closes after pipeline.completed. Send approve
                            # BEFORE we would close if not already.
                            pass

            task = asyncio.create_task(consume())
            # Wait for decision.completed to be seen, then approve.
            for _ in range(150):
                if observed_decision_id is not None:
                    break
                await asyncio.sleep(0.1)
            if observed_decision_id is None:
                _fail("§8 never saw decision.completed")
            r = await ac.post(f"/approve/{observed_decision_id}",
                              json={"approver": "acceptance@example"})
            if r.status_code != 200:
                _fail(f"§8 /approve {r.status_code}: {r.text}")
            try:
                await asyncio.wait_for(got_approval.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                _fail("§8 approval.granted never arrived on the stream")
            task.cancel()
    print("PASS §8: approval.granted event landed on the still-live stream")


# --- driver ---------------------------------------------------------
def main() -> None:
    check_1_boundary()
    asyncio.run(check_2_startup())
    dec_id = asyncio.run(check_3_and_9_inject_and_stream())
    asyncio.run(check_4_audit_roundtrip(dec_id))
    asyncio.run(check_5_fallback_path())
    asyncio.run(check_6_late_subscriber())
    asyncio.run(check_7_read_endpoints())
    asyncio.run(check_8_approval_echo())
    print("\nAll Layer 4 acceptance checks PASSED.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the full acceptance sweep**

Run: `cd backend && PYTHONPATH=. ./venv/bin/python -m api.tests.acceptance`
Expected:
```
PASS §1: api/ only imports public agent entrypoints
PASS §2: app boots + fallback triple loads
PASS §3: SSE event taxonomy valid (…)
PASS §9: live e2e … under 180s cap
PASS §4: audit list contains new row; /approve flips status
PASS §5: fallback path completes in …s, all events tagged mode=fallback
PASS §6: late subscriber received full replay (…)
PASS §7: /detections + /metrics respond <500ms with expected shape
PASS §8: approval.granted event landed on the still-live stream

All Layer 4 acceptance checks PASSED.
```

If any check fails, investigate at the failure site — do NOT weaken the check to make it pass.

- [ ] **Step 3: Regression — Layer 3b still passes**

Run: `cd backend && PYTHONPATH=. ./venv/bin/python -m agents.decision.acceptance`
Expected: `All Layer 3b acceptance checks PASSED.` (9/9)

- [ ] **Step 4: Commit**

```bash
git add backend/api/tests/acceptance.py
git commit -m "test(api): Layer 4 acceptance sweep — 9 checks"
```

---

## Task 16: README + spec back-reference

**Files:**
- Create: `backend/api/README.md`

- [ ] **Step 1: Write api/README.md**

Create `backend/api/README.md`:

```markdown
# API Layer (Layer 4)

FastAPI + SSE for the Studio Crisis Commander dashboard. Wraps the four
existing pipeline stages (Detection → Investigation → Decision → Report)
in one background task per run, streams the live agent trace over
Server-Sent Events, and serves the read/approval endpoints the frontend
consumes.

## Boundaries

- May import `data.ch_client` directly.
- May call the public entrypoints of `agents.investigation`,
  `agents.decision`, `agents.report`, and the `agents.decision.audit`
  facade (`list_recent_audit`, `get_audit`, `async_get_audit`,
  `async_approve_decision`, `deny_decision`, `AuditRow`).
- MUST NOT import any `_provenance`, `subagents`, `prompts`, `actions`,
  or private audit functions. Enforced by §1 grep in
  `api/tests/acceptance.py`.

## Layout

| File | Role |
| --- | --- |
| `main.py` | FastAPI app, lifespan (load cached triple), CORS, router mounts, `/healthz`. |
| `runtime.py` | `PipelineRuntime`: run registry, replay buffer, subscriber fan-out, TTL, decision→run index. |
| `pipeline.py` | `run_pipeline(...)` — the background coroutine; live path + fallback swap on exception. |
| `events.py` | `SseEvent` dataclass + SSE wire serializer. |
| `fallback.py` | Cached-triple loader + paced replayer. |
| `detection_source.py` | Post-inject DetectionIn producer (refresh+SELECT, synth fallback). |
| `routers/inject.py` | `POST /inject-crisis`. |
| `routers/stream.py` | `GET /stream/investigation/{run_id}` (SSE). |
| `routers/detections.py` | `GET /detections`. |
| `routers/audit.py` | `GET /audit`, `POST /approve/{id}`, `POST /deny/{id}`. |
| `routers/metrics.py` | `GET /metrics/{film_id}/{region}`. |
| `cached/fallback_triple.json` | Pre-captured pipeline triple used when live fails. |
| `tests/acceptance.py` | 9-check live sweep. |
| `tests/regenerate_fallback.py` | Regenerate the cached triple (~$0.10 per run). |

## Running

Local dev:

```
cd backend
PYTHONPATH=. venv/bin/uvicorn api.main:app --reload --port 8000
```

Full acceptance sweep (live, ~$0.20):

```
PYTHONPATH=. venv/bin/python -m api.tests.acceptance
```

Regenerate cached fallback triple (only when contracts change, ~$0.10):

```
PYTHONPATH=. venv/bin/python -m api.tests.regenerate_fallback
```

## Environment

- `CORS_ORIGINS` — comma-separated list, or `*` (default). Set when the
  frontend deploys.
- All ClickHouse / Google credentials come from the existing `.env`
  used by Layers 1-3.

## Spec

`docs/superpowers/specs/2026-08-09-layer-4-orchestration-api-design.md`
```

- [ ] **Step 2: Commit**

```bash
git add backend/api/README.md
git commit -m "docs(api): Layer 4 README"
```

---

## Post-plan checklist

Run once at the end to confirm everything works together:

- [ ] All unit tests pass: `cd backend && PYTHONPATH=. ./venv/bin/pytest api/ agents/ -x -q` (Layer 3b tests remain green).
- [ ] Layer 3b acceptance passes: `PYTHONPATH=. ./venv/bin/python -m agents.decision.acceptance`.
- [ ] Layer 4 acceptance passes: `PYTHONPATH=. ./venv/bin/python -m api.tests.acceptance`.
- [ ] `uvicorn api.main:app` boots in <3s and `/healthz` returns 200.
- [ ] `git log --oneline` shows tidy commits, one per task.
