"""Executive Report Agent — one Flash LlmAgent (no tools) + provenance check.

Flow:
  1. LlmAgent reads (investigation, decision) from session state.
  2. Emits an ExecutiveReport (Pydantic-validated by output_schema).
  3. Orchestrator runs validate_report_provenance — raises
     ReportProvenanceError if any KeyFigure.source_query doesn't match
     inputs verbatim.
  4. Orchestrator overrides report_id, created_at, latency_ms.
  5. Orchestrator attaches the report to the audit row.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from agents.decision.audit import async_audit_attach_report
from agents.decision.contracts import DecisionResult
from agents.investigation.contracts import InvestigationResult
from agents.report._provenance import validate_report_provenance
from agents.report.contracts import ExecutiveReport
from agents.report.prompts import REPORT_PROMPT


REPORT_TIMEOUT_SECONDS = 120.0
FLASH = "gemini-2.5-flash"


class ReportProvenanceError(RuntimeError):
    """Report emitted KeyFigures whose source_query does not match inputs."""

    def __init__(self, violations: list[str]) -> None:
        super().__init__(
            "report provenance violations:\n  - " + "\n  - ".join(violations)
        )
        self.violations = violations


class ReportTimeout(RuntimeError):
    """Report pipeline exceeded REPORT_TIMEOUT_SECONDS."""


def build_report_agent() -> LlmAgent:
    """Fresh LlmAgent for the Report step. No tools — no queries."""
    return LlmAgent(
        name="report",
        model=FLASH,
        instruction=REPORT_PROMPT,
        tools=[],
        output_schema=ExecutiveReport,
        output_key="report",
        description="C-suite executive report with query-anchored KeyFigures.",
    )


async def invoke_report(
    inv: InvestigationResult, dec: DecisionResult,
) -> ExecutiveReport:
    try:
        final = await asyncio.wait_for(
            _run_pipeline(inv, dec), timeout=REPORT_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as e:
        raise ReportTimeout(
            f"Report exceeded {REPORT_TIMEOUT_SECONDS:.0f}s"
        ) from e
    # Audit attach is outside the LLM timeout — it's a write operation that
    # depends on the MCP read path and should not count against the report budget.
    await async_audit_attach_report(dec.decision_id, final)
    return final


async def _run_pipeline(
    inv: InvestigationResult, dec: DecisionResult,
) -> ExecutiveReport:
    t0 = time.perf_counter()

    agent = build_report_agent()
    runner = InMemoryRunner(agent=agent, app_name="report")
    session = await runner.session_service.create_session(
        app_name="report", user_id="report-user",
        state={
            "investigation": inv.model_dump(mode="json"),
            "decision": dec.model_dump(mode="json"),
        },
    )
    async for _ in runner.run_async(
        user_id="report-user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="Write the executive report.")],
        ),
    ):
        pass

    reloaded = await runner.session_service.get_session(
        app_name="report", user_id="report-user", session_id=session.id,
    )
    raw = reloaded.state.get("report")
    if raw is None:
        raise RuntimeError("report agent produced no output in session state")
    if isinstance(raw, str):
        raw = json.loads(raw)

    report = ExecutiveReport.model_validate(raw)

    ok, violations = validate_report_provenance(report, inv, dec)
    if not ok:
        raise ReportProvenanceError(violations)

    final = report.model_copy(update={
        "report_id": uuid4().hex,
        "decision_id": dec.decision_id,
        "created_at": datetime.now(timezone.utc),
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    })

    return final
