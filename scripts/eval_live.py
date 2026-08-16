#!/usr/bin/env python3
"""Live eval CLI — runs 30 scenarios against a running backend.

Usage:
    ./scripts/eval_live.py [--backend-url http://…] [--out data/eval_runs/latest.json]

Requires the backend to be reachable at --backend-url (default: env
EVAL_BACKEND_URL or http://127.0.0.1:8000). Writes the artifact JSON
to --out (default: data/eval_runs/latest.json) and prints the headline
number to stdout.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from eval.live import make_live_executor
from eval.runner import run_scenarios, save_artifact
from eval.scenarios import load_scenarios


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Live eval harness")
    p.add_argument("--backend-url", default=None)
    p.add_argument("--out", type=Path,
                   default=REPO_ROOT / "data" / "eval_runs" / "latest.json")
    return p.parse_args()


async def main() -> int:
    args = parse()
    scenarios = load_scenarios()
    executor = make_live_executor(args.backend_url)
    artifact = await run_scenarios(scenarios, executor=executor, mode="live")
    save_artifact(artifact, args.out)
    print(f"{artifact.correct}/{artifact.total} correct "
          f"({artifact.errored} errored) → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
