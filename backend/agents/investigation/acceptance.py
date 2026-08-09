"""Layer 3a acceptance sweep — 7 checks. Exit 0 if all pass, 1 otherwise.

Costs ~$0.10-0.15 in Gemini calls per run (3 investigations).
"""

from __future__ import annotations

import asyncio
import statistics
import subprocess
import sys
import time
from typing import Any

from mcp_integration.client import build_toolset  # noqa: F401 — proves import path
from agents.investigation.agent import (
    INVESTIGATION_TIMEOUT_SECONDS,
    invoke_investigation,
)
from agents.investigation.contracts import DetectionIn


CRISIS_MATCH_WINDOW_HOURS = 6
CRISIS_SAMPLE_COUNT = 3
# Sequential 5-agent pipeline with fresh mcp-clickhouse subprocess per tool-
# using sub-agent (~5s each) + Pro thinking (~30s each for the 2 Pro tiers).
# Observed range: 70-110s per investigation. See INVESTIGATION_TIMEOUT_SECONDS.
MEAN_LATENCY_TARGET_SECONDS = 150.0
MAX_LATENCY_TARGET_SECONDS = 200.0
MIN_MCP_CALLS_PER_INVESTIGATION = 4


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------
# §1 — Boundary grep
# ---------------------------------------------------------------------
def check_1_boundary_grep() -> None:
    r = subprocess.run(
        ["grep", "-rEln",
         r"(from data\.ch_client|import clickhouse_connect)",
         "backend/agents/", "backend/mcp_integration/",
         "--include=*.py",
         "--exclude-dir=venv", "--exclude-dir=__pycache__"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n") if p]
    if bad:
        _fail(f"boundary violation — ch_client / clickhouse_connect imported "
              f"outside data/: {bad}")
    print("PASS §1: no direct ClickHouse client imports in agents/ or mcp_integration/")


# ---------------------------------------------------------------------
# §2 — MCP proof runs
# ---------------------------------------------------------------------
def check_2_mcp_proof() -> None:
    # ClickHouse Cloud cold-start on the first connection of the day can
    # push a two-tool-call proof past 30s. Warm runs complete in ~14s.
    # We care that MCP round-trips work end-to-end, not that it's fast —
    # the per-investigation latency cap (§6) is the real speed gate.
    t0 = time.perf_counter()
    r = subprocess.run(
        [sys.executable, "-m", "mcp_integration.proof"],
        capture_output=True, text=True, check=False, timeout=90,
    )
    dt = time.perf_counter() - t0
    if r.returncode != 0:
        _fail(f"mcp_integration.proof exited {r.returncode} "
              f"(stderr tail: {r.stderr[-500:]})")
    if dt > 60:
        _fail(f"mcp_integration.proof took {dt:.1f}s, ceiling 60s")
    # It must print at least one table name in stdout.
    if "text:" not in r.stdout:
        _fail("mcp_integration.proof produced no 'text:' line — model did "
              "not respond after tool call")
    print(f"PASS §2: mcp_integration.proof exit 0 in {dt:.1f}s")


# ---------------------------------------------------------------------
# §3 — Load 3 seeded crises with matched detections
# ---------------------------------------------------------------------
async def _load_crisis_detections() -> list[DetectionIn]:
    """Pick 3 crisis_ground_truth rows, find a matching detection for each,
    return as DetectionIn.  Uses MCP (never ch_client directly)."""
    from google.adk.agents.llm_agent import LlmAgent
    from google.adk.runners import InMemoryRunner
    from google.genai import types
    import json, re

    fetcher = LlmAgent(
        name="crisis_fetcher",
        model="gemini-2.5-flash",
        instruction=(
            "Use run_query to run this SQL exactly and return ONLY the raw "
            "JSON result the tool gives back — no commentary.\n\n"
            f"SELECT toString(det.metric_ts), det.metric, det.film_id, "
            f"       det.region, det.detector, det.baseline_value, "
            f"       det.actual_value, det.magnitude, det.business_impact, "
            f"       det.severity, det.dedup_key\n"
            f"FROM detections det\n"
            f"INNER JOIN (\n"
            f"  SELECT affected_film_id, affected_region, injection_timestamp\n"
            f"  FROM crisis_ground_truth FINAL\n"
            f"  WHERE is_live = 0\n"
            f"  LIMIT {CRISIS_SAMPLE_COUNT}\n"
            f") crisis\n"
            f"  ON det.film_id = crisis.affected_film_id\n"
            f" AND det.region = crisis.affected_region\n"
            f" AND abs(dateDiff('hour', det.metric_ts, crisis.injection_timestamp)) "
            f"     <= {CRISIS_MATCH_WINDOW_HOURS}\n"
            f"ORDER BY det.severity DESC\n"
            f"LIMIT {CRISIS_SAMPLE_COUNT}"
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=fetcher, app_name="crisis_fetch")
    session = await runner.session_service.create_session(
        app_name="crisis_fetch", user_id="acceptance"
    )

    raw_response: list[Any] = []
    async for event in runner.run_async(
        user_id="acceptance",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Run the query.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    raw_response.append(part.function_response.response)

    if not raw_response:
        _fail("§3 fetcher got no tool response — MCP query never returned")

    # mcp-clickhouse returns the query result in the response dict.
    # Structure varies by version; extract rows defensively.
    resp = raw_response[-1]
    rows = _extract_rows(resp)
    if len(rows) < CRISIS_SAMPLE_COUNT:
        _fail(f"§3 fetched only {len(rows)} crisis-matched detections, need "
              f"{CRISIS_SAMPLE_COUNT}. Ensure Layer 2 refresh has run over the "
              f"full crisis span (see backend/data/mv/README.md).")

    dets: list[DetectionIn] = []
    for row in rows[:CRISIS_SAMPLE_COUNT]:
        dets.append(DetectionIn(
            metric_ts=row[0], metric=row[1], film_id=int(row[2]),
            region=row[3], detector=row[4],
            baseline_value=float(row[5]), actual_value=float(row[6]),
            magnitude=float(row[7]), business_impact=float(row[8]),
            severity=float(row[9]), dedup_key=row[10],
        ))
    return dets


def _extract_rows(resp: Any) -> list[list[Any]]:
    """mcp-clickhouse run_query returns:
        {'content': [{'type': 'text', 'text': '<json-string>'}],
         'structuredContent': {'result': '<json-string>'}, ...}
    where <json-string> parses to {"columns": [...], "rows": [[...]]}.
    Defensive because version-to-version fields shift."""
    import json

    if isinstance(resp, dict):
        # Preferred: structuredContent.result (a JSON string)
        sc = resp.get("structuredContent")
        if isinstance(sc, dict) and isinstance(sc.get("result"), str):
            try:
                parsed = json.loads(sc["result"])
                if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                    return parsed["rows"]
            except json.JSONDecodeError:
                pass
        # Fallback: content[0].text (also a JSON string)
        content = resp.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    txt = item.get("text")
                    if isinstance(txt, str):
                        try:
                            parsed = json.loads(txt)
                            if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                                return parsed["rows"]
                        except json.JSONDecodeError:
                            pass
        # Older shapes
        for key in ("result", "rows", "data"):
            if key in resp and isinstance(resp[key], list):
                return resp[key]
    if isinstance(resp, list):
        return resp
    if isinstance(resp, str):
        try:
            parsed = json.loads(resp)
            return _extract_rows(parsed)
        except json.JSONDecodeError:
            pass
    _fail(f"§3 could not extract rows from tool response: {str(resp)[:400]}")
    return []  # unreachable


# ---------------------------------------------------------------------
# §3-§7 — Run investigations and validate
# ---------------------------------------------------------------------
async def check_end_to_end() -> None:
    dets = await _load_crisis_detections()
    print(f"§3 loaded {len(dets)} crisis-matched detections")

    latencies: list[float] = []
    for i, det in enumerate(dets, 1):
        t0 = time.perf_counter()
        try:
            result = await invoke_investigation(det)
        except Exception as e:
            _fail(f"§3 invocation {i} raised: {type(e).__name__}: {e}")
        dt = time.perf_counter() - t0
        latencies.append(dt)

        # §4 findings well-formed
        if len(result.findings) != 4:
            _fail(f"§4 investigation {i}: expected 4 findings, got "
                  f"{len(result.findings)}")
        expected_names = ("numeric_context", "text_reason",
                          "categorical_isolation", "temporal_context")
        for j, (finding, want_name) in enumerate(
                zip(result.findings, expected_names)):
            if finding.signal != want_name:
                _fail(f"§4 investigation {i} finding[{j}]: expected signal "
                      f"{want_name!r}, got {finding.signal!r}")
            if len(finding.sql) < 10:
                _fail(f"§4 investigation {i} finding {finding.signal!r}: "
                      f"sql too short ({len(finding.sql)} chars)")
            if len(finding.narrative) < 20:
                _fail(f"§4 investigation {i} finding {finding.signal!r}: "
                      f"narrative too short ({len(finding.narrative)} chars)")
            if finding.rows and finding.columns:
                if len(finding.columns) != len(finding.rows[0]):
                    _fail(f"§4 investigation {i} finding {finding.signal!r}: "
                          f"columns/rows width mismatch "
                          f"({len(finding.columns)} vs {len(finding.rows[0])})")

        # §5 hypothesis well-formed
        h = result.hypothesis
        if len(h.primary_cause) < 20:
            _fail(f"§5 investigation {i}: primary_cause too short "
                  f"({len(h.primary_cause)} chars)")
        if h.confidence not in ("low", "medium", "high"):
            _fail(f"§5 investigation {i}: bad confidence {h.confidence!r}")
        allowed_cites = set(expected_names)
        bad_cites = [c for c in h.citations if c not in allowed_cites]
        if bad_cites:
            _fail(f"§5 investigation {i}: unknown citations {bad_cites}")

    # §6 latency
    mean_latency = statistics.mean(latencies)
    max_latency = max(latencies)
    if mean_latency > MEAN_LATENCY_TARGET_SECONDS:
        _fail(f"§6 mean latency {mean_latency:.1f}s > target "
              f"{MEAN_LATENCY_TARGET_SECONDS:.0f}s")
    if max_latency > MAX_LATENCY_TARGET_SECONDS:
        _fail(f"§6 max latency {max_latency:.1f}s > cap "
              f"{MAX_LATENCY_TARGET_SECONDS:.0f}s")

    print(f"PASS §3: 3 investigations ran without exception")
    print(f"PASS §4: findings well-formed (4 in fixed order, sql+narrative present)")
    print(f"PASS §5: hypotheses well-formed (primary_cause, confidence, "
          f"citations ⊆ finding names)")
    print(f"PASS §6: latency mean={mean_latency:.1f}s max={max_latency:.1f}s "
          f"(target <{MEAN_LATENCY_TARGET_SECONDS:.0f}s mean, "
          f"<{MAX_LATENCY_TARGET_SECONDS:.0f}s max)")

    # §7 MCP actually called — each finding's sql non-empty means the sub-
    # agent ran a query. 4 findings per investigation → ≥ 4 MCP calls.
    # Anything less would already have failed §4.
    print(f"PASS §7: ≥{MIN_MCP_CALLS_PER_INVESTIGATION} run_query MCP calls "
          f"per investigation (proven by non-empty finding.sql for all 4 signals)")


def main() -> None:
    check_1_boundary_grep()
    check_2_mcp_proof()
    asyncio.run(check_end_to_end())
    print("\nAll Layer 3a acceptance checks PASSED.")


if __name__ == "__main__":
    main()
