"""Pydantic contracts for the Investigation Agent pipeline.

DetectionIn — one row of Layer 2's `detections` table. Layer 4 fetches
via MCP and passes into invoke_investigation().

SignalFinding — output of one of the 4 signal-family sub-agents. Carries
the SQL that was run and the raw rows returned; narrative must only cite
numbers that appear in `rows`.

Hypothesis — output of the synthesis sub-agent. citations names the
signal(s) that support each claim.

InvestigationResult — the top-level assembled artifact returned to
Layer 4.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


SignalName = Literal[
    "numeric_context",
    "text_reason",
    "categorical_isolation",
    "temporal_context",
]


class DetectionIn(BaseModel):
    """One row of Layer 2's `detections` table."""

    metric_ts: datetime
    metric: str
    film_id: int
    region: str
    detector: str
    baseline_value: float
    actual_value: float
    magnitude: float
    business_impact: float
    severity: float
    dedup_key: str
    # Populated by detection_source.py via a films-JOIN when available.
    # Optional so cached triples and older DetectionIn payloads still validate.
    film_title: str = ""


class SignalFinding(BaseModel):
    """Output of one signal-family sub-agent."""

    signal: SignalName
    sql: str = Field(..., description="Full SQL executed via MCP")
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list,
                                  description="Raw query result — every "
                                              "number in narrative traces here")
    narrative: str
    latency_ms: int = 0


class Hypothesis(BaseModel):
    """Output of the synthesis sub-agent."""

    primary_cause: str
    contributing_factors: list[str] = Field(default_factory=list)
    confidence: Literal["low", "medium", "high"]
    citations: list[SignalName]

    @field_validator("citations")
    @classmethod
    def _citations_non_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("Hypothesis must cite at least one finding")
        return v


class InvestigationResult(BaseModel):
    """Top-level artifact returned by invoke_investigation()."""

    investigation_id: str = Field(default_factory=lambda: uuid4().hex)
    detection: DetectionIn
    findings: list[SignalFinding] = Field(
        ..., description="length 4, in fixed order matching sub-agent order"
    )
    hypothesis: Hypothesis
    started_at: datetime
    finished_at: datetime
