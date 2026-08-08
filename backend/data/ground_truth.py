"""Pydantic model + writer for the crisis_ground_truth table (Layer 6 eval source of truth)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from data.ch_client import client


class CrisisType(str, Enum):
    REGIONAL_SENTIMENT_COLLAPSE = "regional_sentiment_collapse"
    TRAILER_VARIANT_UNDERPERFORMANCE = "trailer_variant_underperformance"
    COMPETITOR_RELEASE_IMPACT = "competitor_release_impact"
    MARKETING_OVERSPEND_LOW_ROI = "marketing_overspend_low_roi"
    STREAMING_COMPLETION_DROP = "streaming_completion_drop"
    REFUND_SPIKE = "refund_spike"
    NEGATIVE_SOCIAL_VIRALITY = "negative_social_virality"
    REVIEW_SCORE_DIVERGENCE = "review_score_divergence"


class Crisis(BaseModel):
    crisis_id: UUID = Field(default_factory=uuid4)
    injection_timestamp: datetime
    is_live: bool
    type: CrisisType
    affected_film_id: int
    affected_region: str
    magnitude: float
    affected_tables: list[str]
    true_root_cause: str
    expected_recommendation: str
    resolution_window_hours: int


def write(crisis: Crisis) -> None:
    row = [
        crisis.crisis_id,
        crisis.injection_timestamp,
        1 if crisis.is_live else 0,
        crisis.type.value,
        crisis.affected_film_id,
        crisis.affected_region,
        float(crisis.magnitude),
        list(crisis.affected_tables),
        crisis.true_root_cause,
        crisis.expected_recommendation,
        int(crisis.resolution_window_hours),
    ]
    cols = [
        "crisis_id", "injection_timestamp", "is_live", "type",
        "affected_film_id", "affected_region", "magnitude",
        "affected_tables", "true_root_cause", "expected_recommendation",
        "resolution_window_hours",
    ]
    with client() as c:
        c.insert("crisis_ground_truth", [row], column_names=cols)


def verify() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM crisis_ground_truth").result_rows[0][0]
    print(f"crisis_ground_truth OK: {n} rows.")


if __name__ == "__main__":
    verify()
