"""Live executor — POSTs /inject-crisis, subscribes to SSE, parses
investigation.completed to extract hypothesis.primary_cause.

One retry on any transport-level failure. On the second failure we
return errored=True — the scenario is dropped from the accuracy
denominator but recorded so the artifact still shows what happened.
"""
from __future__ import annotations

import asyncio
import json
import os
import time

import httpx

from eval.runner import Executor, ExecutorOutput
from eval.scenarios import Scenario


DEFAULT_BACKEND_URL = os.getenv("EVAL_BACKEND_URL", "http://127.0.0.1:8000")
DEFAULT_TIMEOUT_S = 240.0


def make_live_executor(
    base_url: str | None = None,
    *,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> Executor:
    url = (base_url or DEFAULT_BACKEND_URL).rstrip("/")

    async def live_executor(scn: Scenario) -> ExecutorOutput:
        for attempt in (1, 2):
            try:
                return await _run_once(scn, url, timeout_s)
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    return ExecutorOutput(
                        primary_cause=f"__ERROR__ {type(e).__name__}: {e}",
                        latency_ms=0,
                        errored=True,
                    )
                await asyncio.sleep(1.0)
        # unreachable
        return ExecutorOutput(primary_cause="__ERROR__ unreachable",
                              latency_ms=0, errored=True)

    return live_executor


async def _run_once(scn: Scenario, base_url: str, timeout_s: float) -> ExecutorOutput:
    t0 = time.perf_counter()
    async with httpx.AsyncClient(base_url=base_url, timeout=timeout_s) as ac:
        r = await ac.post("/inject-crisis", json={
            "ctype": scn.crisis_type,
            "film_id": scn.film_id,
            "region": scn.region,
            "magnitude": scn.magnitude,
        })
        if r.status_code != 202:
            raise RuntimeError(f"/inject-crisis returned {r.status_code}: {r.text}")
        run_id = r.json()["run_id"]

        async with ac.stream("GET", f"/stream/investigation/{run_id}") as stream:
            async for line in stream.aiter_lines():
                if not line.startswith("data: "):
                    continue
                body = json.loads(line[len("data: "):])
                if body.get("type") == "investigation.completed":
                    inv = body["data"]["investigation"]
                    primary = inv.get("hypothesis", {}).get("primary_cause", "")
                    return ExecutorOutput(
                        primary_cause=str(primary),
                        latency_ms=int((time.perf_counter() - t0) * 1000),
                        errored=False,
                    )
                if body.get("type") == "pipeline.failed":
                    raise RuntimeError(f"pipeline.failed: {body['data'].get('error', 'unknown')}")

    raise RuntimeError("stream closed without investigation.completed")
