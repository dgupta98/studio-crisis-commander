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


# RunState is mutated only via PipelineRuntime methods (which hold the
# lock). Callers of register()/get() must treat the returned reference
# as read-only.
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
    def __init__(self, *, max_runs: int = 50, max_age_seconds: float = 3600.0):
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
        try:
            self._order.remove(run_id)
        except ValueError:
            pass
        st = self._runs.pop(run_id, None)
        if st is None:
            return
        # Signal any lingering subscribers then drop.
        for q in st.subscribers:
            q.put_nowait(_SENTINEL)
        st.subscribers.clear()
        if st.decision_id is not None:
            self._decision_index.pop(st.decision_id, None)
