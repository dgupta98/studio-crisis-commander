"""Scenario definition + JSON loader for the eval harness.

The JSON at backend/eval/scenarios.json is the source of truth. Each entry:
  {
    "id": "sc_001",
    "crisis_type": "regional_sentiment_collapse",  # must be a CrisisType enum value
    "film_id": 1,
    "region": "Brazil",
    "magnitude": 0.35,
    "expected_primary_cause": "regional_sentiment_collapse"  # equals crisis_type
  }
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from data.ground_truth import CrisisType


CrisisTypeStr = Literal[
    "regional_sentiment_collapse",
    "trailer_variant_underperformance",
    "competitor_release_impact",
    "marketing_overspend_low_roi",
    "streaming_completion_drop",
    "refund_spike",
    "negative_social_virality",
    "review_score_divergence",
]


DEFAULT_PATH = Path(__file__).parent / "scenarios.json"


class Scenario(BaseModel):
    id: str
    crisis_type: CrisisTypeStr
    film_id: int = Field(ge=1)
    region: str
    magnitude: float = Field(gt=0)
    expected_primary_cause: CrisisTypeStr


def load_scenarios(path: Path | None = None) -> list[Scenario]:
    """Read + model-validate all scenarios from a JSON array. Fails loud."""
    raw = json.loads(Path(path or DEFAULT_PATH).read_text())
    if not isinstance(raw, list):
        raise ValueError(f"scenarios.json must be a JSON array, got {type(raw).__name__}")
    return [Scenario.model_validate(row) for row in raw]


# Sanity: keep the loader honest against the enum. Fails at import if the
# Literal list drifts from CrisisType.
_ENUM_VALUES = {t.value for t in CrisisType}
_LITERAL_VALUES = {
    "regional_sentiment_collapse", "trailer_variant_underperformance",
    "competitor_release_impact", "marketing_overspend_low_roi",
    "streaming_completion_drop", "refund_spike",
    "negative_social_virality", "review_score_divergence",
}
assert _ENUM_VALUES == _LITERAL_VALUES, (
    f"scenarios.CrisisTypeStr drifted from CrisisType enum: "
    f"enum={_ENUM_VALUES} literal={_LITERAL_VALUES}"
)
