"""GET /detections — recent detection rows for the anomaly feed."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query

from data.ch_client import client


router = APIRouter(tags=["reads"])

_COLS = ("metric_ts", "metric", "film_id", "region",
         "detector", "baseline_value", "actual_value",
         "magnitude", "business_impact", "severity", "dedup_key",
         "film_title", "latency_ms")


@router.get("/detections")
async def detections(
    limit: int = Query(50, ge=1, le=500),
    since_hours: int = Query(24, ge=1, le=8760),
):
    def _run() -> list[list]:
        # LEFT JOIN films so the frontend can show titles in the anomaly
        # feed. coalesce keeps the payload string-typed on JOIN miss.
        # NOTE: `latency_ms` here is query-time (now - metric_ts). SSE
        # payloads carry produce-time latency captured at ingest by
        # api.detection_source._latency_ms — same field, different clocks.
        # `greatest(0,…)` matches the Python floor for clock-skew safety.
        #
        # Anchor the time window on max(metric_ts), not now(), so the feed
        # is populated whether the synthetic pipeline is actively producing
        # or the demo is replaying an older snapshot. Falls back to now()
        # if the table is empty (fresh install).
        sql = (
            f"SELECT toString(d.metric_ts), d.metric, d.film_id, d.region, "
            f"d.detector, d.baseline_value, d.actual_value, d.magnitude, "
            f"d.business_impact, d.severity, d.dedup_key, "
            f"coalesce(f.title, '') AS film_title, "
            f"greatest(0, toUnixTimestamp64Milli(now64(3)) - toUnixTimestamp64Milli(d.metric_ts)) AS latency_ms "
            f"FROM detections AS d "
            f"LEFT JOIN films AS f ON f.film_id = d.film_id "
            f"WHERE d.metric_ts >= coalesce("
            f"  (SELECT max(metric_ts) FROM detections) - INTERVAL {int(since_hours)} HOUR,"
            f"  now() - INTERVAL {int(since_hours)} HOUR"
            f") "
            f"ORDER BY d.severity DESC LIMIT {int(limit)}"
        )
        with client() as c:
            return [list(r) for r in c.query(sql).result_rows]
    t0 = time.perf_counter()
    rows = await asyncio.to_thread(_run)
    dt_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "detections": [dict(zip(_COLS, r)) for r in rows],
        "query_latency_ms": dt_ms,
    }
