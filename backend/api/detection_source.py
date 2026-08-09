"""Produce a DetectionIn for the pipeline, post-injection.

Path:
  1. inject_now(...) has already run and returned a Crisis.
  2. refresh_detections(since_hours=6) — recomputes detector output.
  3. SELECT the freshest matching row.
  4. If found within poll_seconds → build DetectionIn from row.
  5. Else → synthesize DetectionIn from the Crisis directly (fallback path).
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Literal

from agents.investigation.contracts import DetectionIn
from data.ch_client import client
from data.ground_truth import Crisis, CrisisType
from data.mv.refresh import refresh_detections


# Canonical metric name for each CrisisType. Mapping is best-guess; the
# detector produces rows against these metric names, so the SELECT below
# looks for a match. If none is found in the poll window we synth anyway.
_CRISIS_METRIC: dict[CrisisType, str] = {
    CrisisType.REGIONAL_SENTIMENT_COLLAPSE:      "audience_sentiment.avg_score",
    CrisisType.TRAILER_VARIANT_UNDERPERFORMANCE: "trailer_analytics.completion_rate",
    CrisisType.COMPETITOR_RELEASE_IMPACT:        "box_office_revenue.revenue_usd",
    CrisisType.MARKETING_OVERSPEND_LOW_ROI:      "campaign_performance.roi",
    CrisisType.STREAMING_COMPLETION_DROP:        "streaming_watch_minutes.completion_rate",
    CrisisType.REFUND_SPIKE:                     "ticket_refunds.refund_rate",
    CrisisType.NEGATIVE_SOCIAL_VIRALITY:         "social_trends.avg_virality",
    CrisisType.REVIEW_SCORE_DIVERGENCE:          "review_scores.avg_score",
}


def synth_from_crisis(crisis: Crisis) -> DetectionIn:
    """Build a DetectionIn directly from a Crisis object (fallback path)."""
    metric = _CRISIS_METRIC.get(crisis.type, "unknown.metric")
    ts = crisis.injection_timestamp
    return DetectionIn(
        metric_ts=ts,
        metric=metric,
        film_id=crisis.affected_film_id,
        region=crisis.affected_region,
        detector="synth",
        baseline_value=0.0,
        actual_value=float(crisis.magnitude),
        magnitude=float(crisis.magnitude),
        business_impact=float(crisis.magnitude),
        severity=float(crisis.magnitude),
        dedup_key=(
            f"{metric}|{crisis.affected_film_id}|{crisis.affected_region}|"
            f"{ts.isoformat(timespec='seconds')}|synth"
        ),
    )


async def _select_matching_row(
    film_id: int, region: str, since_ts: datetime,
) -> dict[str, Any] | None:
    """One-shot SELECT for the freshest matching detection row.

    Runs in a thread — clickhouse-connect is sync. Returns None on 0 rows."""
    def _run() -> list[list[Any]]:
        sql = (
            "SELECT metric_ts, metric, film_id, region, detector, "
            "baseline_value, actual_value, magnitude, business_impact, "
            "severity, dedup_key "
            "FROM detections "
            f"WHERE film_id = {int(film_id)} "
            f"AND region = '{region}' "
            f"AND metric_ts >= toDateTime('{since_ts.strftime('%Y-%m-%d %H:%M:%S')}') "
            "ORDER BY metric_ts DESC LIMIT 1"
        )
        with client() as c:
            return [list(r) for r in c.query(sql).result_rows]
    rows = await asyncio.to_thread(_run)
    if not rows:
        return None
    r = rows[0]
    return {
        "metric_ts": r[0], "metric": r[1], "film_id": r[2], "region": r[3],
        "detector": r[4], "baseline_value": r[5], "actual_value": r[6],
        "magnitude": r[7], "business_impact": r[8], "severity": r[9],
        "dedup_key": r[10],
    }


async def produce_detection(
    crisis: Crisis, *, poll_seconds: float = 2.0,
) -> tuple[DetectionIn, Literal["refresh", "fallback_synth"]]:
    """Refresh + SELECT with poll timeout, else synth from Crisis."""
    # Refresh is cheap (<1s); run in a thread since it's sync.
    await asyncio.to_thread(refresh_detections, 6)
    since = crisis.injection_timestamp - _one_hour()
    deadline = time.monotonic() + poll_seconds
    while time.monotonic() < deadline:
        row = await _select_matching_row(
            crisis.affected_film_id, crisis.affected_region, since,
        )
        if row is not None:
            return DetectionIn(**row), "refresh"
        await asyncio.sleep(0.2)
    return synth_from_crisis(crisis), "fallback_synth"


def _one_hour():
    from datetime import timedelta
    return timedelta(hours=1)
