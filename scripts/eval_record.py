#!/usr/bin/env python3
"""One-shot recorder — runs 30 live pipelines and saves triples to
data/eval_cache/{scenario_id}.json so replay parity works.

Usage:
    ./scripts/eval_record.py [--backend-url http://…]

Costs ~$3–5 in Gemini calls. Run once after the pipeline is stable and
after every material contract change. Overwrites existing cache files.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from eval.scenarios import Scenario, load_scenarios


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record cached triples for replay")
    p.add_argument("--backend-url",
                   default=os.getenv("EVAL_BACKEND_URL", "http://127.0.0.1:8000"))
    p.add_argument("--cache-dir", type=Path,
                   default=REPO_ROOT / "data" / "eval_cache")
    return p.parse_args()


async def _record_one(ac: httpx.AsyncClient, scn: Scenario, cache_dir: Path) -> None:
    r = await ac.post("/inject-crisis", json={
        "ctype": scn.crisis_type, "film_id": scn.film_id,
        "region": scn.region, "magnitude": scn.magnitude,
    })
    r.raise_for_status()
    run_id = r.json()["run_id"]

    detection = investigation = decision = report = None
    async with ac.stream("GET", f"/stream/investigation/{run_id}") as s:
        async for line in s.aiter_lines():
            if not line.startswith("data: "):
                continue
            body = json.loads(line[len("data: "):])
            t = body.get("type")
            if t == "detection.completed":
                detection = body["data"]["detection"]
            elif t == "investigation.completed":
                investigation = body["data"]["investigation"]
            elif t == "decision.completed":
                decision = body["data"]["decision"]
            elif t == "report.completed":
                report = body["data"]["report"]
            elif t == "pipeline.completed":
                break
            elif t == "pipeline.failed":
                raise RuntimeError(f"{scn.id}: pipeline.failed: {body['data']}")

    if not (detection and investigation and decision and report):
        raise RuntimeError(
            f"{scn.id}: incomplete triple (det={bool(detection)} inv={bool(investigation)} "
            f"dec={bool(decision)} rep={bool(report)})"
        )

    out = cache_dir / f"{scn.id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "scenario_id": scn.id,
        "detection": detection,
        "investigation": investigation,
        "decision": decision,
        "report": report,
    }, indent=2, default=str))


async def main() -> int:
    args = parse()
    scenarios = load_scenarios()
    print(f"recording {len(scenarios)} scenarios → {args.cache_dir}", file=sys.stderr)
    async with httpx.AsyncClient(base_url=args.backend_url.rstrip("/"),
                                 timeout=300) as ac:
        for i, scn in enumerate(scenarios, 1):
            t0 = time.perf_counter()
            try:
                await _record_one(ac, scn, args.cache_dir)
                dt = time.perf_counter() - t0
                print(f"  [{i}/{len(scenarios)}] {scn.id} OK ({dt:.1f}s)",
                      file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                # httpx transport errors (RemoteProtocolError, ReadError) often
                # stringify to "" when a Cloud Run instance dies mid-stream.
                # Log the type so a bare-error tail cluster is diagnosable.
                print(f"  [{i}/{len(scenarios)}] {scn.id} FAIL: "
                      f"{type(e).__name__}: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
