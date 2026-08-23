"""Factories for the 5 LlmAgent sub-agents composing the Investigation.

Model split (see spec §3):
  - Flash on numeric_context, text_reason, synthesis (simpler tasks)
  - Pro on categorical_isolation, temporal_context (schema-heavy SQL)

Each signal-family sub-agent gets an MCPToolset via `build_toolset()`.
Synthesis has no tools.

POOLED TOOLSET: build_investigation_agent() in agent.py passes ONE shared
MCPToolset to all 4 signal sub-agents so they share a single mcp-clickhouse
subprocess. Spawning 4 subprocesses (one per sub-agent) was costing 4x the
handshake budget under Cloud Run cold-start (~5s * 4 = 20s just to boot
the tools), which occasionally pushed sub-agents past the MCP session
timeout and dropped the run into fallback. Sharing is safe because the
SequentialAgent (and the future ParallelAgent with Semaphore(2)) never
invoke two tools on the same MCPToolset simultaneously in a way the stdio
protocol can't sequence — mcp-clickhouse serializes requests over stdio
by design.

Callers that want per-agent toolsets (tests, one-off scripts) can omit
the `toolset` kwarg — each factory falls back to building its own.

Each sub-agent uses `output_schema=<Pydantic model>` so its final message
must validate against the schema, and `output_key=<name>` so the result
lands in session.state[<name>] where downstream sub-agents (and
invoke_investigation()) can read it.
"""

from __future__ import annotations

import os
from typing import Any

from google.adk.agents.llm_agent import LlmAgent

from agents.investigation.contracts import Hypothesis, SignalFinding
from agents.investigation.prompts import (
    CATEGORICAL_ISOLATION_PROMPT,
    NUMERIC_CONTEXT_PROMPT,
    SYNTHESIS_PROMPT,
    TEMPORAL_CONTEXT_PROMPT,
    TEXT_REASON_PROMPT,
)
from mcp_integration.client import build_toolset


FLASH = os.environ.get("GEMINI_MODEL_FLASH", "gemini-2.5-flash")
PRO   = os.environ.get("GEMINI_MODEL_PRO",   "gemini-2.5-pro")


def _tool(toolset: Any | None) -> list:
    """Return [toolset] if provided, else [build_toolset()] (fresh)."""
    return [toolset] if toolset is not None else [build_toolset()]


def build_numeric_context(toolset: Any | None = None) -> LlmAgent:
    return LlmAgent(
        name="numeric_context",
        model=FLASH,
        instruction=NUMERIC_CONTEXT_PROMPT,
        tools=_tool(toolset),
        output_schema=SignalFinding,
        output_key="numeric_context",
        description="Time series shape of the anomaly.",
    )


def build_text_reason(toolset: Any | None = None) -> LlmAgent:
    return LlmAgent(
        name="text_reason",
        model=FLASH,
        instruction=TEXT_REASON_PROMPT,
        tools=_tool(toolset),
        output_schema=SignalFinding,
        output_key="text_reason",
        description="Raw text evidence explaining the anomaly.",
    )


def build_categorical_isolation(toolset: Any | None = None) -> LlmAgent:
    return LlmAgent(
        name="categorical_isolation",
        model=PRO,
        instruction=CATEGORICAL_ISOLATION_PROMPT,
        tools=_tool(toolset),
        output_schema=SignalFinding,
        output_key="categorical_isolation",
        description="Which slice (region/variant/channel) drives the anomaly.",
    )


def build_temporal_context(toolset: Any | None = None) -> LlmAgent:
    return LlmAgent(
        name="temporal_context",
        model=PRO,
        instruction=TEMPORAL_CONTEXT_PROMPT,
        tools=_tool(toolset),
        output_schema=SignalFinding,
        output_key="temporal_context",
        description="Onset, sibling detections, competitor collisions.",
    )


def build_synthesis() -> LlmAgent:
    return LlmAgent(
        name="synthesis",
        model=FLASH,
        instruction=SYNTHESIS_PROMPT,
        tools=[],
        output_schema=Hypothesis,
        output_key="synthesis",
        description="Fuses the 4 findings into a hypothesis with citations.",
    )
