"""Factories for the 5 LlmAgent sub-agents composing the Investigation.

Model split (see spec §3):
  - Flash on numeric_context, text_reason, synthesis (simpler tasks)
  - Pro on categorical_isolation, temporal_context (schema-heavy SQL)

Each signal-family sub-agent gets a fresh MCPToolset via the shared
`build_toolset()` factory. Synthesis has no tools.

Each sub-agent uses `output_schema=<Pydantic model>` so its final message
must validate against the schema, and `output_key=<name>` so the result
lands in session.state[<name>] where downstream sub-agents (and
invoke_investigation()) can read it.
"""

from __future__ import annotations

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


FLASH = "gemini-2.5-flash"
PRO   = "gemini-2.5-pro"


def build_numeric_context() -> LlmAgent:
    return LlmAgent(
        name="numeric_context",
        model=FLASH,
        instruction=NUMERIC_CONTEXT_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="numeric_context",
        description="Time series shape of the anomaly.",
    )


def build_text_reason() -> LlmAgent:
    return LlmAgent(
        name="text_reason",
        model=FLASH,
        instruction=TEXT_REASON_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="text_reason",
        description="Raw text evidence explaining the anomaly.",
    )


def build_categorical_isolation() -> LlmAgent:
    return LlmAgent(
        name="categorical_isolation",
        model=PRO,
        instruction=CATEGORICAL_ISOLATION_PROMPT,
        tools=[build_toolset()],
        output_schema=SignalFinding,
        output_key="categorical_isolation",
        description="Which slice (region/variant/channel) drives the anomaly.",
    )


def build_temporal_context() -> LlmAgent:
    return LlmAgent(
        name="temporal_context",
        model=PRO,
        instruction=TEMPORAL_CONTEXT_PROMPT,
        tools=[build_toolset()],
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
