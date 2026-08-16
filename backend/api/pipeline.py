"""run_pipeline — the background coroutine that drives one investigation.

Live path emits:
  pipeline.started
  detection.started, detection.completed
  investigation.started, signal.completed x4, investigation.completed
  decision.started, action.proposed x1-3, action.impact_computed x1-3,
    decision.completed
  report.started, report.completed
  pipeline.completed

On any exception (or when force_fallback=True), swaps to demo-safety mode
via api.fallback.replay_cached_triple and emits mode=fallback events.
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
from api.fallback import CachedTriple, replay_cached_triple
from api.runtime import PipelineRuntime
from data.crisis_injector import inject_now


# Populated by api.main at startup. Unit tests patch these directly.
_cached_triple: CachedTriple | None = None
_pacing_scale: float = 1.0


def install_cached_triple(triple: CachedTriple, *, pacing_scale: float = 1.0) -> None:
    """Called by api.main startup once per process."""
    global _cached_triple, _pacing_scale
    _cached_triple = triple
    _pacing_scale = pacing_scale


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

    state = await runtime.get(run_id)
    mode = state.mode if state else "live"
    await emit("pipeline.started",
               {"run_id": run_id, "mode": mode, "requested": request})

    if force_fallback:
        await _run_fallback(runtime, run_id, "forced")
        return

    try:
        # --- Detection ---
        # Inject FIRST so detection.started can carry ground-truth context
        # (crisis type, subject, expected root cause) — the trace panel
        # was otherwise blank for the first ~1-3s while the detector polled.
        crisis = inject_now(
            ctype=request.get("ctype"),
            film_id=request.get("film_id"),
            region=request.get("region"),
            magnitude=request.get("magnitude"),
        )
        await emit("detection.started", {
            "crisis": {
                "type": crisis.type.value,
                "film_id": crisis.affected_film_id,
                "region": crisis.affected_region,
                "magnitude": crisis.magnitude,
                "true_root_cause": crisis.true_root_cause,
                "expected_recommendation": crisis.expected_recommendation,
                "affected_tables": list(crisis.affected_tables),
            },
        })
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
        report = await invoke_report(inv, dec, on_event=sync_emit)
        await emit("report.completed",
                   {"report": report.model_dump(mode="json")})

        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        pending.clear()

        latency_ms = int((time.perf_counter() - t0) * 1000)
        await emit("pipeline.completed",
                   {"run_id": run_id, "latency_ms": latency_ms, "mode": mode})
        await runtime.mark_terminal(run_id, "completed")

    except Exception as e:  # noqa: BLE001
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        pending.clear()
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
    # Rough mapping from exception class → stage; refined later if needed.
    return type(exc).__name__
