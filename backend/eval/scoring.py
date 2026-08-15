"""Keyword classifier + score aggregation for the eval harness.

The Investigation Agent produces a freeform hypothesis.primary_cause string.
We map that string to one of 8 canonical CrisisType values (or "unknown")
by looking for the first matching keyword. Ground truth is the crisis_type
of the injected scenario. A match means the primary hypothesis lines up
with what we injected.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


CanonicalCause = Literal[
    "regional_sentiment_collapse",
    "trailer_variant_underperformance",
    "competitor_release_impact",
    "marketing_overspend_low_roi",
    "streaming_completion_drop",
    "refund_spike",
    "negative_social_virality",
    "review_score_divergence",
    "unknown",
]

Mode = Literal["live", "replay"]


# Iteration order = priority. Keywords chosen from
# backend/data/crisis_injector.py:SCENARIO_META and the language the LLM
# tends to use.
KEYWORDS: dict[str, tuple[str, ...]] = {
    "trailer_variant_underperformance": ("trailer", "variant"),
    "refund_spike": ("refund",),
    "competitor_release_impact": ("competitor", "opening weekend", "market share"),
    "marketing_overspend_low_roi": ("overspend", "roi", "spend rising", "low return"),
    "streaming_completion_drop": ("completion", "watch minutes", "streaming drop"),
    "negative_social_virality": ("viral", "virality", "social media"),
    "review_score_divergence": ("critic", "review score", "divergence", "audience gap"),
    "regional_sentiment_collapse": ("sentiment", "audience negative", "regional negative"),
}


def classify(primary_cause: str) -> str:
    """Return a CanonicalCause value or 'unknown'."""
    if not primary_cause:
        return "unknown"
    haystack = primary_cause.lower()
    for label, kws in KEYWORDS.items():
        for kw in kws:
            if kw in haystack:
                return label
    return "unknown"


class ScoredScenario(BaseModel):
    id: str
    expected: str
    actual: str | None
    matched: bool
    latency_ms: int
    errored: bool
    raw_primary_cause: str


class RunArtifact(BaseModel):
    run_id: str = Field(default_factory=lambda: _now_run_id())
    mode: Mode
    total: int
    correct: int
    errored: int
    accuracy: float
    per_type: dict[str, dict[str, int]]
    scenarios: list[ScoredScenario]


def _now_run_id() -> str:
    return "eval_" + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def aggregate(scored: list[ScoredScenario], *, mode: Mode) -> RunArtifact:
    """Bundle per-scenario results into a RunArtifact.

    accuracy = correct / (total - errored). Errored scenarios do NOT
    count against the score; they're reported separately so a single
    Gemini blip doesn't tank the number.
    """
    total = len(scored)
    correct = sum(1 for s in scored if s.matched)
    errored = sum(1 for s in scored if s.errored)
    denom = max(1, total - errored)
    per_type: dict[str, dict[str, int]] = {}
    for s in scored:
        bucket = per_type.setdefault(s.expected, {"n": 0, "correct": 0})
        bucket["n"] += 1
        if s.matched:
            bucket["correct"] += 1
    return RunArtifact(
        mode=mode,
        total=total,
        correct=correct,
        errored=errored,
        accuracy=round(correct / denom, 3),
        per_type=per_type,
        scenarios=scored,
    )
