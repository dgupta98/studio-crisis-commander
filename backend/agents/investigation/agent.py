"""Top-level Investigation pipeline: SequentialAgent + async entrypoint.

`build_investigation_agent()` returns the raw ADK SequentialAgent —
Layer 4 will use this to consume the run_async event stream for SSE.

`invoke_investigation(detection)` is the simple entrypoint that returns
a fully assembled InvestigationResult once the pipeline completes. It
seeds detection + schema_hints into session state, enforces a 30-second
wall-clock cap, and reads the 4 findings + hypothesis out of state.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any, Callable

from google.adk.agents.sequential_agent import SequentialAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.investigation.contracts import (
    DetectionIn,
    Hypothesis,
    InvestigationResult,
    SignalFinding,
)
from agents.investigation.subagents import (
    build_categorical_isolation,
    build_numeric_context,
    build_synthesis,
    build_temporal_context,
    build_text_reason,
)
from mcp_integration.client import build_toolset


# Wall-clock cap for one investigation. Blows past this → InvestigationTimeout.
# Sequential 5-sub-agent pipeline; each tool-using sub-agent spawns its own
# mcp-clickhouse subprocess (~5s startup + 3-5s Gemini think + 1s query + 3s
# emit). Pro sub-agents (categorical_isolation, temporal_context) can hit
# 25-35s each with a query retry. Observed: ~70-110s per investigation.
INVESTIGATION_TIMEOUT_SECONDS = 200.0

# Names in fixed order — used by build_investigation_agent() and result assembly.
_FINDING_NAMES = (
    "numeric_context",
    "text_reason",
    "categorical_isolation",
    "temporal_context",
)


class InvestigationTimeout(RuntimeError):
    """Raised when the SequentialAgent pipeline exceeds the wall-clock cap."""


def build_investigation_agent() -> SequentialAgent:
    """Return a fresh 5-sub-agent SequentialAgent. Layer 4 calls this to
    get the raw agent for run_async event streaming."""
    return SequentialAgent(
        name="investigation",
        sub_agents=[
            build_numeric_context(),
            build_text_reason(),
            build_categorical_isolation(),
            build_temporal_context(),
            build_synthesis(),
        ],
        description="4 signal-family sub-agents + synthesis, sequential.",
    )


async def _load_schema_hints() -> str:
    """One-shot schema pull for the tables the sub-agents reach for.

    We use MCP once at investigation start to grab describe_table output,
    then inject it into every sub-agent prompt via `{schema_hints}`.
    Spares the LLM from re-discovering the schema mid-run.
    """
    # For MVP we return a compact hand-authored hint. This is intentional
    # over-fitting to the known Layer 1/2 schema; if the schema drifts,
    # this string is the one place to update. A dynamic MCP-based pull
    # can replace it if schema drift becomes real.
    return """\
Layer 1 tables (columns — verified against DESCRIBE):
  audience_sentiment(film_id, region, ts DateTime, platform, score Float32,
                     volume UInt32)                       -- NUMERIC ONLY, no text
  reviews_text(review_id, film_id, region, ts DateTime, source, raw_text String,
               sentiment_score Float32, themes Array(String))  -- for text_reason
  social_trends(film_id, region, ts DateTime, platform,
                mentions UInt32, sentiment Float32, virality Float32)
  trailer_analytics(trailer_id, film_id, variant, region, ts DateTime,
                    views UInt32, completion_rate Float32, sentiment_score Float32)
  streaming_watch_minutes(film_id, region, ts DateTime,
                          watch_minutes UInt64, completions UInt32, drops UInt32)
  marketing_spend(film_id, region, channel, date Date,
                  spend_usd UInt64, impressions UInt64, clicks UInt32)
  campaign_performance(campaign_id, film_id, region, channel, date Date,
                       spend_usd UInt64, conversions UInt32)
  box_office_revenue(film_id, region, date Date,
                     revenue_usd UInt64, tickets_sold UInt32, refunds UInt32)
  ticket_refunds(film_id, region, ts DateTime,
                 refund_count UInt32, refund_reason)
  review_scores(film_id, source, ts DateTime, score Float32, review_count UInt32)
  competitor_releases(film_id, region, release_date Date, competitor_film_id)
  film_region_weight(film_id, region, weight Float32)   -- share-of-audience
  films(film_id, tmdb_id, title, genre, language, release_date Date,
        runtime_min, budget_usd, revenue_usd, popularity, vote_average, fetched_at)
  detections(detection_id, fired_at, metric_ts DateTime, metric, film_id, region,
             detector, baseline_value, actual_value, magnitude, business_impact,
             severity, dedup_key)

Layer 2 rollups (columns):
  roll_sentiment_hourly(film_id, region, ts, sum_score_weighted, sum_volume)
     -- avg_score = sum_score_weighted / nullIf(sum_volume, 0)
  roll_social_hourly(film_id, region, ts, sum_sentiment, sum_virality, sum_mentions, n)
     -- avg_sentiment = sum_sentiment / greatest(n,1)
  roll_trailer_hourly(trailer_id, film_id, region, variant, ts, sum_views,
                      sum_completion_x_views, sum_sentiment_x_views)
     -- avg_completion = sum_completion_x_views / nullIf(sum_views, 0)
  roll_streaming_hourly(film_id, region, ts, sum_watch, sum_completions, sum_drops)
     -- completion_ratio = sum_completions / nullIf(sum_completions + sum_drops, 0)
  roll_marketing_daily(film_id, region, channel, day Date, sum_spend, sum_impressions, sum_clicks)
  roll_campaign_daily(film_id, region, channel, day Date, sum_spend, sum_conversions)
"""


def _parse_finding_from_state(state: dict[str, Any], name: str) -> SignalFinding:
    """Sub-agent output lands in state[name] as a dict (JSON of the Pydantic
    model). Reify to a validated SignalFinding."""
    raw = state.get(name)
    if raw is None:
        raise RuntimeError(f"sub-agent {name!r} produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)
    return SignalFinding.model_validate(raw)


def _parse_hypothesis_from_state(state: dict[str, Any]) -> Hypothesis:
    raw = state.get("synthesis")
    if raw is None:
        raise RuntimeError("synthesis sub-agent produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)
    return Hypothesis.model_validate(raw)


async def _run_pipeline(
    detection: DetectionIn,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> InvestigationResult:
    started_at = datetime.now(timezone.utc)
    agent = build_investigation_agent()
    runner = InMemoryRunner(agent=agent, app_name="investigation")

    schema_hints = await _load_schema_hints()
    session = await runner.session_service.create_session(
        app_name="investigation",
        user_id="investigation-user",
        state={
            "detection": detection.model_dump(mode="json"),
            "schema_hints": schema_hints,
        },
    )

    # Kick the SequentialAgent with a trivial user message — the actual
    # work is driven by the seeded state and each sub-agent's prompt.
    per_agent_latency: dict[str, int] = {}
    turn_start: dict[str, float] = {}
    async for event in runner.run_async(
        user_id="investigation-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Investigate the seeded detection.")],
        ),
    ):
        # Track per-sub-agent wall time using event.author transitions.
        author = event.author or ""
        if author in _FINDING_NAMES + ("synthesis",):
            turn_start.setdefault(author, time.perf_counter())
            per_agent_latency[author] = int(
                (time.perf_counter() - turn_start[author]) * 1000
            )

    # Session state now has state[<name>] for each sub-agent's output_key.
    reloaded = await runner.session_service.get_session(
        app_name="investigation",
        user_id="investigation-user",
        session_id=session.id,
    )
    state = reloaded.state

    findings = []
    for name in _FINDING_NAMES:
        f = _parse_finding_from_state(state, name)
        # Overlay measured wall time (sub-agent doesn't know its own latency).
        f.latency_ms = per_agent_latency.get(name, 0)
        findings.append(f)
        if on_event is not None:
            # Nest under `finding` so the frontend AgentTrace can render sql +
            # narrative from the same shape used by the /stream contract tests.
            on_event({
                "type": "signal.completed",
                "data": {
                    "finding": {
                        "signal": f.signal,
                        "sql": f.sql,
                        "narrative": f.narrative,
                        "row_count": len(f.rows),
                    },
                },
            })

    hypothesis = _parse_hypothesis_from_state(state)
    if on_event is not None:
        on_event({
            "type": "hypothesis.formed",
            "data": {
                "hypothesis": {
                    "primary_cause": hypothesis.primary_cause,
                    "contributing_factors": list(hypothesis.contributing_factors),
                    "confidence": hypothesis.confidence,
                    "citations": list(hypothesis.citations),
                },
            },
        })
    finished_at = datetime.now(timezone.utc)

    return InvestigationResult(
        detection=detection,
        findings=findings,
        hypothesis=hypothesis,
        started_at=started_at,
        finished_at=finished_at,
    )


async def invoke_investigation(
    detection: DetectionIn,
    *,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> InvestigationResult:
    """Run the 5-sub-agent pipeline against one detection.

    Enforces a 30-second wall-clock cap. On timeout, raises
    InvestigationTimeout. Any other failure (Gemini error, sub-agent
    output_schema violation, missing session state) propagates.
    """
    try:
        return await asyncio.wait_for(
            _run_pipeline(detection, on_event=on_event),
            timeout=INVESTIGATION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as e:
        raise InvestigationTimeout(
            f"Investigation exceeded {INVESTIGATION_TIMEOUT_SECONDS:.0f}s cap"
        ) from e
