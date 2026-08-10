"""Layer 4 acceptance sweep — 9 checks. Exit 0 if all pass, 1 otherwise.

  §1 boundary grep       §2 startup + fallback load
  §3 inject+stream taxonomy   §4 audit round-trip
  §5 fallback path       §6 late subscriber
  §7 read endpoints      §8 approval SSE echo
  §9 live e2e under cap

Cost per run: ~$0.20 (§3, §9 each drive one full pipeline; others are
in-memory or read-only). Live checks require the app running.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx


BASE_URL = "http://127.0.0.1:18099"
BOUNDARY_ROOT = Path(__file__).resolve().parents[2]   # backend/


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


# --- §1 -------------------------------------------------------------
def check_1_boundary() -> None:
    """api/ may not import agents' internals — only the public entrypoints."""
    r = subprocess.run(
        ["grep", "-rEln",
         r"^(from agents\.(investigation|decision|report)\.(subagents|prompts|actions|_provenance|acceptance|acceptance_helpers)|"
         r"from agents\.decision\.audit import (_|audit_insert|audit_attach_report|approve_decision(?!_)|_set_approval|_insert_row))",
         "api/", "--include=*.py",
         "--exclude-dir=__pycache__", "--exclude-dir=venv"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n") if p]
    if bad:
        _fail(f"§1 boundary violation — {bad}")
    print("PASS §1: api/ only imports public agent entrypoints")


# --- run app subprocess --------------------------------------------
@asynccontextmanager
async def _running_app():
    """Start uvicorn in a subprocess, poll /healthz, yield, then kill."""
    proc = subprocess.Popen(
        ["./venv/bin/uvicorn", "api.main:app",
         "--host", "127.0.0.1", "--port", "18099"],
        env={**_env(), "PYTHONPATH": "."},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                async with httpx.AsyncClient() as c:
                    r = await c.get(f"{BASE_URL}/healthz", timeout=1.0)
                if r.status_code == 200:
                    break
            except httpx.RequestError:
                pass
            await asyncio.sleep(0.2)
        else:
            _fail("app did not boot within 10s")
        yield
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _env() -> dict:
    import os
    return {k: v for k, v in os.environ.items()}


# --- §2 -------------------------------------------------------------
async def check_2_startup() -> None:
    async with _running_app():
        # If we got here, healthz returned 200 — startup ran (loaded triple + runtime).
        pass
    print("PASS §2: app boots + fallback triple loads")


# --- helpers to consume SSE ----------------------------------------
async def _collect_events(client: httpx.AsyncClient, url: str,
                          until_type: str, max_wait: float = 180.0):
    events: list[dict] = []
    deadline = time.monotonic() + max_wait
    async with client.stream("GET", url, timeout=max_wait) as s:
        async for line in s.aiter_lines():
            if time.monotonic() > deadline:
                _fail(f"SSE stream exceeded {max_wait}s")
            if line.startswith("data: "):
                body = json.loads(line[len("data: "):])
                events.append(body)
                if body["type"] == until_type:
                    return events
    _fail(f"stream closed without receiving {until_type}")


# --- §3 + §9 combined -----------------------------------------------
async def check_3_and_9_inject_and_stream() -> str:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as ac:
            t0 = time.perf_counter()
            r = await ac.post("/inject-crisis", json={})
            if r.status_code != 202:
                _fail(f"§3 POST /inject-crisis returned {r.status_code}")
            run_id = r.json()["run_id"]
            events = await _collect_events(
                ac, f"/stream/investigation/{run_id}",
                until_type="pipeline.completed", max_wait=180.0,
            )
            dt = time.perf_counter() - t0
            types_seen = [e["type"] for e in events]
            assert types_seen.count("detection.completed") == 1, types_seen
            assert types_seen.count("signal.completed") == 4, types_seen
            assert types_seen.count("report.completed") == 1, types_seen
            impact_events = [e for e in events if e["type"] == "action.impact_computed"]
            assert 1 <= len(impact_events) <= 3, f"got {len(impact_events)} impact events"
            print(f"PASS §3: SSE event taxonomy valid "
                  f"({len(events)} events, signals=4, impacts={len(impact_events)})")
            if dt > 180.0:
                _fail(f"§9 live e2e {dt:.1f}s > 180s cap")
            print(f"PASS §9: live e2e {dt:.1f}s under 180s cap")
            # Return the decision_id emitted by decision.completed for §4/§8.
            dec_event = next(e for e in events if e["type"] == "decision.completed")
            return dec_event["data"]["decision"]["decision_id"]
    return ""


# --- §4 -------------------------------------------------------------
async def check_4_audit_roundtrip(decision_id: str) -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as ac:
            r = await ac.get("/audit?limit=100")
            if r.status_code != 200:
                _fail(f"§4 GET /audit returned {r.status_code}")
            audit = r.json()
            if not any(row["decision_id"] == decision_id for row in audit):
                _fail(f"§4 decision_id {decision_id} not found in audit list")
            r = await ac.post(f"/approve/{decision_id}",
                              json={"approver": "acceptance@example",
                                    "note": "auto-approve"})
            if r.status_code != 200:
                _fail(f"§4 /approve returned {r.status_code}: {r.text}")
            body = r.json()
            if body["approval_status"] != "approved":
                _fail(f"§4 approval_status = {body['approval_status']!r}")
    print("PASS §4: audit list contains new row; /approve flips status")


# --- §5 -------------------------------------------------------------
async def check_5_fallback_path() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=60) as ac:
            t0 = time.perf_counter()
            r = await ac.post("/inject-crisis",
                              json={"fallback": "force"})
            if r.status_code != 202:
                _fail(f"§5 POST /inject-crisis?fallback=force returned {r.status_code}")
            run_id = r.json()["run_id"]
            events = await _collect_events(
                ac, f"/stream/investigation/{run_id}",
                until_type="pipeline.completed", max_wait=30.0,
            )
            dt = time.perf_counter() - t0
            if dt > 15.0:
                _fail(f"§5 fallback e2e {dt:.1f}s > 15s (pacing budget)")
            for e in events:
                if e["type"].startswith(("detection.", "investigation.",
                                         "decision.", "report.",
                                         "pipeline.completed", "signal.",
                                         "action.")):
                    if e["data"].get("mode") != "fallback":
                        _fail(f"§5 event {e['type']} missing mode=fallback")
    print(f"PASS §5: fallback path completes in {dt:.1f}s, all events tagged mode=fallback")


# --- §6 -------------------------------------------------------------
async def check_6_late_subscriber() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as ac:
            r = await ac.post("/inject-crisis",
                              json={"fallback": "force"})
            run_id = r.json()["run_id"]
            await asyncio.sleep(2.0)   # let some events accumulate
            events = await _collect_events(
                ac, f"/stream/investigation/{run_id}",
                until_type="pipeline.completed", max_wait=30.0,
            )
            types = [e["type"] for e in events]
            # Late subscriber must still see early events via replay.
            if "detection.started" not in types:
                _fail(f"§6 late subscriber missed detection.started: {types}")
    print(f"PASS §6: late subscriber received full replay ({len(events)} events)")


# --- §7 -------------------------------------------------------------
async def check_7_read_endpoints() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as ac:
            t0 = time.perf_counter()
            r1 = await ac.get("/detections?limit=10")
            t1 = time.perf_counter()
            r2 = await ac.get("/metrics/1/Brazil?hours=48")
            t2 = time.perf_counter()
            if r1.status_code != 200:
                _fail(f"§7 /detections {r1.status_code}")
            if not r1.json()["detections"]:
                _fail("§7 /detections empty")
            if (t1 - t0) > 0.5:
                _fail(f"§7 /detections {t1-t0:.2f}s > 0.5s")
            if r2.status_code != 200:
                _fail(f"§7 /metrics {r2.status_code}")
            keys = set(r2.json()["timeseries"].keys())
            expected = {"box_office_daily", "social_virality_hourly",
                        "sentiment_hourly", "trailer_hourly"}
            if keys != expected:
                _fail(f"§7 /metrics keys {keys} != {expected}")
            if (t2 - t1) > 0.5:
                _fail(f"§7 /metrics {t2-t1:.2f}s > 0.5s")
    print(f"PASS §7: /detections + /metrics respond <500ms with expected shape")


# --- §8 -------------------------------------------------------------
async def check_8_approval_echo() -> None:
    async with _running_app():
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=200) as ac:
            r = await ac.post("/inject-crisis",
                              json={"fallback": "force"})
            run_id = r.json()["run_id"]
            got_approval = asyncio.Event()
            observed_decision_id = None

            async def consume():
                nonlocal observed_decision_id
                async with ac.stream("GET",
                                     f"/stream/investigation/{run_id}") as s:
                    async for line in s.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        body = json.loads(line[len("data: "):])
                        if body["type"] == "decision.completed":
                            observed_decision_id = body["data"]["decision"]["decision_id"]
                        if body["type"] == "approval.granted":
                            got_approval.set()
                            return
                        if body["type"] == "pipeline.completed":
                            # Fallback runs to completion in ~10s; the stream
                            # closes after pipeline.completed. Send approve
                            # BEFORE we would close if not already.
                            pass

            task = asyncio.create_task(consume())
            # Wait for decision.completed to be seen, then approve.
            for _ in range(150):
                if observed_decision_id is not None:
                    break
                await asyncio.sleep(0.1)
            if observed_decision_id is None:
                _fail("§8 never saw decision.completed")
            r = await ac.post(f"/approve/{observed_decision_id}",
                              json={"approver": "acceptance@example"})
            if r.status_code != 200:
                _fail(f"§8 /approve {r.status_code}: {r.text}")
            try:
                await asyncio.wait_for(got_approval.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                _fail("§8 approval.granted never arrived on the stream")
            task.cancel()
    print("PASS §8: approval.granted event landed on the still-live stream")


# --- driver ---------------------------------------------------------
def main() -> None:
    check_1_boundary()
    asyncio.run(check_2_startup())
    dec_id = asyncio.run(check_3_and_9_inject_and_stream())
    asyncio.run(check_4_audit_roundtrip(dec_id))
    asyncio.run(check_5_fallback_path())
    asyncio.run(check_6_late_subscriber())
    asyncio.run(check_7_read_endpoints())
    asyncio.run(check_8_approval_echo())
    print("\nAll Layer 4 acceptance checks PASSED.")


if __name__ == "__main__":
    main()
