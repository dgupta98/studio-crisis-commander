"""Pydantic contracts for the Executive Report Agent.

KeyFigure.source_query is the provenance anchor: every number cited in
the report MUST come from a SQL that was actually run (either an
investigation finding SQL, or a decision action impact_sql).

value is a string, not a float — the LLM may format as "-42%", "$1.2M",
"3 of 5 regions", etc. Provenance is enforced via source_query, not by
re-parsing the number.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FindingSource(BaseModel):
    """Points at the query that produced a KeyFigure.

    For signal in the 4 investigation types: query_index selects into
    inv.findings[i].sql (Layer 3a emits one SQL per finding — usually 0).

    For signal == 'decision_impact': query_index selects into
    dec.actions[i].impact_sql.
    """

    signal: Literal[
        "numeric_context", "text_reason",
        "categorical_isolation", "temporal_context",
        "decision_impact",
    ]
    query_index: int = Field(ge=0)


class KeyFigure(BaseModel):
    """One anchored number in the executive report."""

    label: str = Field(min_length=3)
    value: str = Field(min_length=1)
    source_query: str = Field(min_length=10)
    source: FindingSource


class ExecutiveReport(BaseModel):
    """Top-level artifact returned by invoke_report()."""

    report_id: str
    decision_id: str
    headline: str = Field(min_length=20, max_length=200)
    tldr: str = Field(min_length=40, max_length=800)
    key_figures: list[KeyFigure] = Field(min_length=1, max_length=8)
    recommended_actions_prose: str = Field(min_length=40)
    risks_and_caveats: str
    created_at: datetime
    latency_ms: int = 0
