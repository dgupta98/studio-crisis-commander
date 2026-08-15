"""Replay executor — loads a cached triple and returns its primary_cause.

No network. A missing cache file is a hard failure with the scenario id
in the exception so the operator knows which scenario to record.
"""
from __future__ import annotations

import json
from pathlib import Path

from eval.runner import Executor, ExecutorOutput
from eval.scenarios import Scenario


DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "eval_cache"


class CachedTripleMissing(RuntimeError):
    """Raised when a scenario's cache file is not on disk."""


def make_replay_executor(cache_dir: Path | None = None) -> Executor:
    root = Path(cache_dir or DEFAULT_CACHE_DIR)

    async def replay_executor(scn: Scenario) -> ExecutorOutput:
        path = root / f"{scn.id}.json"
        if not path.exists():
            raise CachedTripleMissing(
                f"no cached triple for scenario {scn.id} at {path}. "
                f"Record it with scripts/eval_record.py or check the id."
            )
        triple = json.loads(path.read_text())
        try:
            primary = triple["investigation"]["hypothesis"]["primary_cause"]
        except (KeyError, TypeError) as e:
            raise CachedTripleMissing(
                f"cached triple {path} malformed: missing "
                f"investigation.hypothesis.primary_cause ({e})"
            ) from e
        return ExecutorOutput(primary_cause=str(primary), latency_ms=0, errored=False)

    return replay_executor
