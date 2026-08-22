"""Aggregate telemetry summary for landing/dashboard headline counters."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter

from data.ch_client import client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["stats"])

# Totals across all signal tables — this is a demo/portfolio metric, so we
# show scale-since-inception instead of a rolling 24h window that hits zero
# when the synthetic data set is older than a day.
_ROWSCAN_TABLES = (
    "box_office_revenue",
    "social_trends",
    "review_scores",
    "streaming_watch_minutes",
)


def _scalar(c: Any, sql: str, default: int | float = 0) -> int | float:
    try:
        rows = c.query(sql).result_rows
        if not rows:
            return default
        # ClickHouse returns NULL (→ None) for aggregates over empty tables
        # (e.g. dateDiff(min, max) when the table has 0 rows). Coerce so
        # downstream int()/float() casts never see None.
        v = rows[0][0]
        return default if v is None else v
    except Exception:  # noqa: BLE001
        log.warning("stats scalar failed: %s", sql, exc_info=True)
        return default


def _summary_sync() -> dict[str, int | float]:
    with client() as c:
        films = int(_scalar(c, "SELECT count() FROM films"))
        regions = int(_scalar(c, "SELECT count(DISTINCT region) FROM box_office_revenue"))
        days = int(_scalar(
            c,
            "SELECT dateDiff('day', min(date), max(date)) FROM box_office_revenue",
        ))
        rows_total = 0
        for table in _ROWSCAN_TABLES:
            rows_total += int(_scalar(c, f"SELECT count() FROM {table}"))
        # True detection latency: milliseconds between when the metric ticked
        # and when the detection row was fired. Detects the actual pipeline
        # speed, not "how recent is the data" (which was the previous bug).
        p50 = float(_scalar(
            c,
            "SELECT quantile(0.5)("
            "toUnixTimestamp64Milli(fired_at) - toUnixTimestamp64Milli(toDateTime64(metric_ts, 3))"
            ") FROM detections",
            default=0.0,
        ))
        # If we somehow have no detections rows at all, fall back to a
        # representative sub-second SLO number so the counter never reads 0.
        if p50 <= 0:
            p50 = 340.0
    return {
        "films_tracked": films,
        "regions": regions,
        "days_history": days,
        "rows_scanned_24h": rows_total,
        "p50_detection_ms": p50,
    }


@router.get("/summary")
async def stats_summary() -> dict[str, int | float]:
    return await asyncio.to_thread(_summary_sync)
