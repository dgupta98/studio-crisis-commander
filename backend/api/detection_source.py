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
def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _latency_ms(metric_ts: datetime | str) -> int:
    """Return ms between metric_ts and _utc_now(). Non-negative; 0 on parse err."""
    if isinstance(metric_ts, str):
        try:
            mts = datetime.fromisoformat(metric_ts.replace("Z", "+00:00"))
        except ValueError:
            return 0
    else:
        mts = metric_ts
    if mts.tzinfo is None:
        mts = mts.replace(tzinfo=timezone.utc)
    delta = (_utc_now() - mts).total_seconds() * 1000
    return max(0, int(delta))


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


def _lookup_film_title(film_id: int) -> str:
    """One-shot title lookup so the frontend can show a movie name.

    Runs in a thread — clickhouse-connect is sync. Empty string on miss."""
    def _run() -> str:
        with client() as c:
            rows = c.query(
                f"SELECT title FROM films WHERE film_id = {int(film_id)} LIMIT 1"
            ).result_rows
        return str(rows[0][0]) if rows else ""
    try:
        return _run()
    except Exception:  # noqa: BLE001
        # Non-fatal: title is a display nicety; ID-only fallback is fine.
        return ""


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
        film_title=_lookup_film_title(crisis.affected_film_id),
        latency_ms=_latency_ms(ts),
    )


async def _select_matching_row(
    film_id: int, region: str, since_ts: datetime,
) -> dict[str, Any] | None:
    """One-shot SELECT for the freshest matching detection row.

    Runs in a thread — clickhouse-connect is sync. Returns None on 0 rows."""
    def _run() -> list[list[Any]]:
        # LEFT JOIN films so the frontend can render a movie title alongside
        # the film_id. Empty string on miss keeps the display graceful.
        sql = (
            "SELECT d.metric_ts, d.metric, d.film_id, d.region, d.detector, "
            "d.baseline_value, d.actual_value, d.magnitude, d.business_impact, "
            "d.severity, d.dedup_key, coalesce(f.title, '') AS film_title "
            "FROM detections AS d "
            "LEFT JOIN films AS f ON f.film_id = d.film_id "
            f"WHERE d.film_id = {int(film_id)} "
            f"AND d.region = '{region}' "
            f"AND d.metric_ts >= toDateTime('{since_ts.strftime('%Y-%m-%d %H:%M:%S')}') "
            "ORDER BY d.metric_ts DESC LIMIT 1"
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
        "dedup_key": r[10], "film_title": r[11],
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
            return DetectionIn(**row, latency_ms=_latency_ms(row["metric_ts"])), "refresh"
        await asyncio.sleep(0.2)
    return synth_from_crisis(crisis), "fallback_synth"


def _one_hour():
    from datetime import timedelta
    return timedelta(hours=1)
