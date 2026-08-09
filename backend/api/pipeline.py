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

import asyncio
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
    pending: list[asyncio.Task] = []

    async def emit(type_: str, data: dict[str, Any]) -> None:
        await runtime.emit(run_id, SseEvent(seq=seq.next(), type=type_, data=data))

    def sync_emit(payload: dict[str, Any]) -> None:
        """Sub-agent callback: schedule an emit without blocking the LLM path.
        Task is tracked so the pipeline can wait for it before terminating."""
        pending.append(
            asyncio.create_task(emit(payload["type"], payload["data"]))
        )

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

        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        pending.clear()

        latency_ms = int((time.perf_counter() - t0) * 1000)
        await emit("pipeline.completed",
                   {"run_id": run_id, "latency_ms": latency_ms, "mode": mode})
        await runtime.mark_terminal(run_id, "completed")

    except Exception as e:  # noqa: BLE001 - fallback handling added in Task 8
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        pending.clear()
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
