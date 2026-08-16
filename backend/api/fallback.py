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
    "hypothesis.formed": 0.5,
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
        await emit("signal.completed", {
            "finding": {
                "signal": f.signal,
                "sql": f.sql,
                "narrative": f.narrative,
                "row_count": len(f.rows),
            },
        })
    hyp = triple.investigation.hypothesis
    await emit("hypothesis.formed", {
        "hypothesis": {
            "primary_cause": hyp.primary_cause,
            "contributing_factors": list(hyp.contributing_factors),
            "confidence": hyp.confidence,
            "citations": list(hyp.citations),
        },
    })
    await emit("investigation.completed",
               {"investigation": triple.investigation.model_dump(mode="json")})
    await emit("decision.started", {})
    for a in triple.decision.actions:
        await emit("action.proposed", {
            "action_type": a.action_type,
            "priority": a.priority,
            "rationale": a.rationale,
            "params": dict(a.params),
        })
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
