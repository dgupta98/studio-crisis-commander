"""Pydantic contracts for the Decision Agent.

Rule of thumb: LLM narrates, SQL computes. RecommendedAction enforces that
via a model_validator — impact_sql MUST be non-empty whenever impact_usd
is populated. That's the whole spec §2 provenance guarantee at the type
level.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


ActionType = Literal[
    "shift_marketing_spend",
    "pause_campaign",
    "swap_trailer_variant",
    "issue_pr_statement",
    "escalate_to_human",
]


ApprovalStatus = Literal[
    "auto_executed",
    "pending_approval",
    "approved",
    "denied",
]


class RecommendedAction(BaseModel):
    """One ranked action inside a DecisionResult."""

    action_type: ActionType
    rationale: str = Field(min_length=20)
    params: dict = Field(default_factory=dict)
    impact_usd: float | None = None
    impact_sql: str = ""
    impact_error: str = ""
    priority: int = Field(ge=1, le=3)

    @model_validator(mode="after")
    def _impact_sql_required_when_number(self) -> "RecommendedAction":
        if self.impact_usd is not None and not self.impact_sql:
            raise ValueError(
                "impact_sql must be non-empty when impact_usd is set — "
                "every number must trace to a query"
            )
        return self


class DecisionResult(BaseModel):
    """Top-level artifact returned by invoke_decision()."""

    decision_id: str
    investigation_id: str
    actions: list[RecommendedAction] = Field(min_length=1, max_length=3)
    status: ApprovalStatus
    threshold_usd: float
    created_at: datetime
    latency_ms: int = 0
