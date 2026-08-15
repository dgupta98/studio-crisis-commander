"""Shared runner logic — feeds scenarios through an executor and scores."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Awaitable, Callable

from pydantic import BaseModel

from eval.scenarios import Scenario
from eval.scoring import (
    Mode, RunArtifact, ScoredScenario, aggregate, classify,
)


class ExecutorOutput(BaseModel):
    """One executor invocation's result — normalized across live/replay."""

    primary_cause: str
    latency_ms: int = 0
    errored: bool = False


Executor = Callable[[Scenario], Awaitable[ExecutorOutput]]


async def run_scenarios(
    scenarios: list[Scenario],
    *,
    executor: Executor,
    mode: Mode,
) -> RunArtifact:
    """Iterate scenarios sequentially, execute each, classify, aggregate.

    Sequential (not concurrent) because the live executor drives a shared
    ClickHouse + Gemini stack; parallelism would just create rate-limit
    contention with no wall-clock win under normal quotas.
    """
    scored: list[ScoredScenario] = []
    for scn in scenarios:
        out = await executor(scn)
        actual = classify(out.primary_cause) if not out.errored else None
        matched = (not out.errored) and actual == scn.expected_primary_cause
        scored.append(ScoredScenario(
            id=scn.id,
            expected=scn.expected_primary_cause,
            actual=actual,
            matched=matched,
            latency_ms=out.latency_ms,
            errored=out.errored,
            raw_primary_cause=out.primary_cause,
        ))
    return aggregate(scored, mode=mode)


def save_artifact(artifact: RunArtifact, out_path: Path) -> None:
    """Write the run artifact to disk as pretty JSON."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(artifact.model_dump(mode="json"), indent=2, default=str)
    )
