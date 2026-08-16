"""Decision Agent — one Flash LlmAgent (no tools) + Python orchestrator.

Flow:
  1. LlmAgent proposes actions with rationale + params (no SQL/no numbers).
  2. Orchestrator validates params, renders canonical SQL per action.
  3. Orchestrator executes each SQL directly via clickhouse-connect (BUILD-RISK-FALLBACK;
     original MCP-mediated approach cost 15-20s per query due to LLM schema discovery).
  4. Orchestrator populates impact_usd / impact_sql on each action.
  5. Orchestrator computes status (auto vs pending) from thresholds.
  6. Orchestrator writes the audit row.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.decision.actions import (
    compute_status, render_action_sql, validate_params,
)
from agents.decision.audit import audit_insert, run_impact_sql
from agents.decision.contracts import DecisionResult, RecommendedAction
from agents.decision.prompts import DECISION_PROMPT
from agents.investigation.contracts import InvestigationResult

DECISION_TIMEOUT_SECONDS = 90.0
FLASH = os.environ.get("GEMINI_MODEL_FLASH", "gemini-2.5-flash")


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


async def invoke_decision(
    inv: InvestigationResult,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> DecisionResult:
    """Run the Decision Agent, orchestrate impact SQL, persist audit row."""
    try:
        return await asyncio.wait_for(
            _run_pipeline(inv, on_event=on_event),
            timeout=DECISION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as e:
        raise DecisionTimeout(
            f"Decision exceeded {DECISION_TIMEOUT_SECONDS:.0f}s"
        ) from e


async def _run_pipeline(
    inv: InvestigationResult,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> DecisionResult:
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

    if on_event is not None:
        for a in proposed.actions:
            on_event({
                "type": "action.proposed",
                "data": {"action_type": a.action_type, "priority": a.priority},
            })

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

    # --- 3. Execute impact SQL directly via clickhouse-connect (BUILD-RISK-FALLBACK)
    # Impact SQLs are rendered from canonical TEMPLATES with validated params.
    # Original LLM-mediated MCP approach cost 15-20s per query (schema discovery);
    # direct execution is safe and completes in <1s per query.
    impacts = await _run_impacts([sql for _, sql in rendered])
    for (action, _), impact in zip(rendered, impacts):
        if isinstance(impact, Exception):
            action.impact_error = str(impact)[:400]
        elif impact is None:
            action.impact_error = "query returned no rows"
        else:
            action.impact_usd = impact
        if on_event is not None:
            on_event({
                "type": "action.impact_computed",
                "data": {
                    "action_type": action.action_type,
                    "impact_usd": action.impact_usd,
                    "impact_error": action.impact_error or None,
                },
            })

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
    sqls: list[str],
) -> list[float | None | Exception]:
    """Execute impact SQLs directly via clickhouse-connect (BUILD-RISK-FALLBACK).

    Replaces the original LLM-mediated MCP approach: each _run_one_impact spin-up
    cost 15-20s due to schema discovery. run_impact_sql (in audit.py, already exempt
    from the §1 boundary rule) executes the validated canonical SQL in <1s.
    """
    results: list[float | None | Exception] = []
    for sql in sqls:
        if not sql:
            results.append(None)
            continue
        try:
            results.append(run_impact_sql(sql))
        except Exception as e:                                # noqa: BLE001
            results.append(e)
    return results


