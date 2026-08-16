#!/usr/bin/env python3
"""Replay eval CLI — scores 30 cached triples from data/eval_cache/.

Usage:
    ./scripts/eval_replay.py [--cache-dir data/eval_cache] [--out data/eval_runs/replay-latest.json]

Zero network. Fails loud if any scenario's cache file is missing.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from eval.replay import make_replay_executor
from eval.runner import run_scenarios, save_artifact
from eval.scenarios import load_scenarios


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Replay eval harness")
    p.add_argument("--cache-dir", type=Path,
                   default=REPO_ROOT / "data" / "eval_cache")
    p.add_argument("--out", type=Path,
                   default=REPO_ROOT / "data" / "eval_runs" / "replay-latest.json")
    return p.parse_args()


async def main() -> int:
    args = parse()
    scenarios = load_scenarios()
    executor = make_replay_executor(cache_dir=args.cache_dir)
    artifact = await run_scenarios(scenarios, executor=executor, mode="replay")
    save_artifact(artifact, args.out)
    print(f"{artifact.correct}/{artifact.total} correct "
          f"({artifact.errored} errored) → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
