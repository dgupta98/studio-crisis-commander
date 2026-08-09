"""Decision Agent — one Flash LlmAgent (no tools) + Python orchestrator.

Flow:
  1. LlmAgent proposes actions with rationale + params (no SQL/no numbers).
  2. Orchestrator validates params, renders canonical SQL per action.
  3. Orchestrator executes each SQL through a shared MCPToolset.
  4. Orchestrator populates impact_usd / impact_sql on each action.
  5. Orchestrator computes status (auto vs pending) from thresholds.
  6. Orchestrator writes the audit row.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.decision.actions import (
    compute_status, render_action_sql, validate_params,
)
from agents.decision.audit import audit_insert
from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.decision.prompts import DECISION_PROMPT
from agents.investigation.contracts import InvestigationResult
from mcp_integration.client import build_toolset


DECISION_TIMEOUT_SECONDS = 45.0
FLASH = "gemini-2.5-flash"


class DecisionImpactError(RuntimeError):
    """All actions had SQL failures — nothing to auto-execute or approve."""


class DecisionTimeout(RuntimeError):
    """Decision pipeline exceeded DECISION_TIMEOUT_SECONDS."""


def build_decision_agent() -> LlmAgent:
    """Fresh LlmAgent for the Decision step. No tools — semantic only.

    Layer 4 uses this directly for SSE event streaming.
    """
    return LlmAgent(
        name="decision",
        model=FLASH,
        instruction=DECISION_PROMPT,
        tools=[],
        output_schema=DecisionResult,
        output_key="decision",
        description="Proposes 1-3 SQL-grounded, threshold-gated actions.",
    )


async def invoke_decision(inv: InvestigationResult) -> DecisionResult:
    """Run the Decision Agent, orchestrate impact SQL, persist audit row."""
    try:
        return await asyncio.wait_for(
            _run_pipeline(inv), timeout=DECISION_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as e:
        raise DecisionTimeout(
            f"Decision exceeded {DECISION_TIMEOUT_SECONDS:.0f}s"
        ) from e


async def _run_pipeline(inv: InvestigationResult) -> DecisionResult:
    t0 = time.perf_counter()

    # --- 1. LLM proposes actions ---------------------------------------
    agent = build_decision_agent()
    runner = InMemoryRunner(agent=agent, app_name="decision")
    session = await runner.session_service.create_session(
        app_name="decision", user_id="decision-user",
        state={"investigation": inv.model_dump(mode="json")},
    )
    async for _ in runner.run_async(
        user_id="decision-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(
                text="Propose 1-3 RecommendedActions for the investigation."
            )],
        ),
    ):
        pass

    reloaded = await runner.session_service.get_session(
        app_name="decision", user_id="decision-user", session_id=session.id,
    )
    raw = reloaded.state.get("decision")
    if raw is None:
        raise RuntimeError("decision agent produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)

    # Strip any impact fields the LLM might have leaked in violation of Rule 5.
    for a in raw.get("actions", []):
        a["impact_usd"] = None
        a["impact_sql"] = ""
        a["impact_error"] = ""

    proposed = DecisionResult.model_validate(raw)

    # --- 2. Validate params + render SQL --------------------------------
    rendered: list[tuple[RecommendedAction, str]] = []
    for a in proposed.actions:
        try:
            validate_params(a.action_type, a.params)
            sql = render_action_sql(a.action_type, a.params)
            a.impact_sql = sql
        except ValueError as e:
            a.impact_error = f"param validation: {e}"
            sql = ""
        rendered.append((a, sql))

    # --- 3. Execute impact SQL via a shared MCP toolset ------------------
    toolset = build_toolset()
    impacts = await _run_impacts(toolset, [sql for _, sql in rendered])
    for (action, _), impact in zip(rendered, impacts):
        if isinstance(impact, Exception):
            action.impact_error = str(impact)[:400]
        elif impact is None:
            action.impact_error = "query returned no rows"
        else:
            action.impact_usd = impact

    if all(a.impact_usd is None for a in proposed.actions):
        raise DecisionImpactError(
            "All impact SQLs failed — no action has a computed impact_usd. "
            "Details: " + " | ".join(
                f"[{a.action_type}] {a.impact_error}" for a in proposed.actions
            )
        )

    # --- 4. Recompute status + finalize the DecisionResult ---------------
    status, threshold = compute_status(list(proposed.actions))
    final = DecisionResult(
        decision_id=uuid4().hex,
        investigation_id=inv.investigation_id,
        actions=list(proposed.actions),
        status=status,
        threshold_usd=threshold,
        created_at=datetime.now(timezone.utc),
        latency_ms=int((time.perf_counter() - t0) * 1000),
    )

    # --- 5. Audit persist ------------------------------------------------
    audit_insert(final, inv)

    return final


# ---------------------------------------------------------------------
# Impact-SQL executor — runs each rendered SQL through mcp-clickhouse and
# extracts the single Float64 impact_usd cell. Runs sequentially (small
# N=1..3; sequential keeps the shared MCP subprocess simple).
# ---------------------------------------------------------------------

async def _run_impacts(
    toolset: Any, sqls: list[str],
) -> list[float | None | Exception]:
    results: list[float | None | Exception] = []
    for sql in sqls:
        if not sql:
            results.append(None)
            continue
        try:
            results.append(await _run_one_impact(toolset, sql))
        except Exception as e:                                # noqa: BLE001
            results.append(e)
    return results


async def _run_one_impact(toolset: Any, sql: str) -> float | None:
    """Run one impact SQL via a stub agent that uses the shared toolset."""
    agent = LlmAgent(
        name="impact_runner",
        model=FLASH,
        instruction=(
            "Call run_query with EXACTLY this SQL and return ONLY the raw "
            "JSON result the tool gives back:\n\n" + sql
        ),
        tools=[toolset],
    )
    runner = InMemoryRunner(agent=agent, app_name="impact")
    session = await runner.session_service.create_session(
        app_name="impact", user_id="impact",
    )
    rows: list[list[Any]] = []
    async for event in runner.run_async(
        user_id="impact",
        session_id=session.id,
        new_message=types.Content(
            role="user", parts=[types.Part.from_text(text="Run it.")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.function_response:
                    rows = _extract_rows(part.function_response.response) or rows
    if not rows or not rows[0]:
        return None
    val = rows[0][0]
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _extract_rows(resp: Any) -> list[list[Any]]:
    """Mirror of audit._extract_rows — mcp-clickhouse response parser."""
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
