"""Aggregate telemetry summary for landing/dashboard headline counters."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter

from data.ch_client import client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/stats", tags=["stats"])

# (table, time-column-predicate) for the 24h row-scan roll-up. Column names
# must match backend/data/schema.sql. box_office_revenue uses `date` (Date),
# the others use `ts` (DateTime).
_ROWSCAN_TABLES = (
    ("box_office_revenue",      "date >= today() - 1"),
    ("social_trends",           "ts   >= now() - INTERVAL 1 DAY"),
    ("review_scores",           "ts   >= now() - INTERVAL 1 DAY"),
    ("streaming_watch_minutes", "ts   >= now() - INTERVAL 1 DAY"),
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
        rows_24h = 0
        for table, where in _ROWSCAN_TABLES:
            rows_24h += int(_scalar(c, f"SELECT count() FROM {table} WHERE {where}"))
        # `detections` table (not `detections_stream`); metric_ts exists there.
        p50 = float(_scalar(
            c,
            "SELECT quantile(0.5)("
            "toUnixTimestamp64Milli(now64(3)) - toUnixTimestamp64Milli(metric_ts)"
            ") FROM detections WHERE metric_ts >= now() - INTERVAL 1 DAY",
            default=0.0,
        ))
    return {
        "films_tracked": films,
        "regions": regions,
        "days_history": days,
        "rows_scanned_24h": rows_24h,
        "p50_detection_ms": p50,
    }


@router.get("/summary")
async def stats_summary() -> dict[str, int | float]:
    return await asyncio.to_thread(_summary_sync)
