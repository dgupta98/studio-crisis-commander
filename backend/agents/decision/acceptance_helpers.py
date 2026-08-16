"""Helpers used by acceptance.py — kept separate so imports stay clean.

load_one_crisis_detection: pick one non-live crisis and turn its matching
detection into a DetectionIn. Uses MCP (never ch_client directly) so §1
boundary grep passes.

reload_impact: re-run an already-rendered impact SQL to confirm the value
the decision orchestrator stored matches a fresh query. Delegates to
audit.run_impact_sql (already §1-exempt) — same executor the decision
agent used, so drift is measured apples-to-apples.
"""

from __future__ import annotations

import json
import os
from typing import Any

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.decision.audit import run_impact_sql
from agents.investigation.contracts import DetectionIn
from mcp_integration.client import build_toolset


async def load_one_crisis_detection() -> DetectionIn:
    """Pick one crisis_ground_truth row with a matching detection.

    Returns the highest-severity match. Fails loudly if none found.
    """
    sql = (
        "SELECT toString(det.metric_ts), det.metric, det.film_id, det.region, "
        "       det.detector, det.baseline_value, det.actual_value, det.magnitude, "
        "       det.business_impact, det.severity, det.dedup_key "
        "FROM detections det "
        "INNER JOIN ("
        "  SELECT affected_film_id, affected_region, injection_timestamp "
        "  FROM crisis_ground_truth FINAL WHERE is_live = 0 LIMIT 5"
        ") crisis "
        "  ON det.film_id = crisis.affected_film_id "
        " AND det.region = crisis.affected_region "
        " AND abs(dateDiff('hour', det.metric_ts, crisis.injection_timestamp)) <= 6 "
        "ORDER BY det.severity DESC LIMIT 1"
    )
    rows = await _run_query(sql)
    if not rows:
        raise RuntimeError(
            "no crisis-matched detection available for live smoke — "
            "Layer 2 rollup may not cover the crisis span"
        )
    r = rows[0]
    return DetectionIn(
        metric_ts=r[0], metric=r[1], film_id=int(r[2]), region=r[3],
        detector=r[4], baseline_value=float(r[5]), actual_value=float(r[6]),
        magnitude=float(r[7]), business_impact=float(r[8]),
        severity=float(r[9]), dedup_key=r[10],
    )


async def reload_impact(sql: str) -> float | None:
    """Re-run an impact SQL via the same executor the decision orchestrator used.

    Delegates to audit.run_impact_sql (already §1-exempt) instead of going
    through LLM+MCP again — the drift check is about SQL determinism, not
    boundary compliance, and the LLM+MCP path costs 9 extra Flash calls per
    acceptance run (~one per fixture-action) which spikes 429 quota.
    """
    return run_impact_sql(sql)


async def _run_query(sql: str) -> list[list[Any]]:
    agent = LlmAgent(
        name="acceptance_query",
        model=os.environ.get("GEMINI_MODEL_FLASH", "gemini-2.5-flash-preview-05-20"),
        instruction=(
            "Call run_query with EXACTLY this SQL and return ONLY the raw "
            "JSON result the tool gives back:\n\n" + sql
        ),
        tools=[build_toolset()],
    )
    runner = InMemoryRunner(agent=agent, app_name="acceptance_query")
    session = await runner.session_service.create_session(
        app_name="acceptance_query", user_id="acceptance",
    )
    rows: list[list[Any]] = []
    async for event in runner.run_async(
        user_id="acceptance",
        session_id=session.id,
        new_message=types.Content(
            role="user", parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    rows = _extract_rows(part.function_response.response) or rows
    return rows


def _extract_rows(resp: Any) -> list[list[Any]]:
    if isinstance(resp, dict):
        sc = resp.get("structuredContent")
        if isinstance(sc, dict) and isinstance(sc.get("result"), str):
            try:
                parsed = json.loads(sc["result"])
                if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list):
                    return parsed["rows"]
            except json.JSONDecodeError:
                pass
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
    return []
