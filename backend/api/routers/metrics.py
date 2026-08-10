"""GET /metrics/{film_id}/{region} — 4 parallel rollup timeseries."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query

from data.ch_client import client


router = APIRouter(tags=["reads"])


def _q_box_office(film_id: int, region: str, hours: int) -> str:
    days = max(1, hours // 24)
    return (
        f"SELECT toString(date) AS ts, revenue_usd, tickets_sold "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND date >= today() - INTERVAL {days} DAY "
        f"ORDER BY date"
    )


def _q_social(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts, "
        f"sum_virality / greatest(n, 1) AS avg_virality, "
        f"n AS volume "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= now() - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _q_sentiment(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts, "
        f"sum_score_weighted / greatest(sum_volume, 1) AS avg_score, "
        f"sum_volume AS volume "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= now() - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _q_trailer(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts, sum_views AS views, "
        f"sum_completion_x_views / greatest(sum_views, 1) AS completion_rate "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= now() - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _run_query_sync(sql: str, cols: tuple[str, ...]) -> list[dict]:
    with client() as c:
        rows = c.query(sql).result_rows
    return [dict(zip(cols, r)) for r in rows]


async def _run(sql: str, cols: tuple[str, ...]) -> list[dict]:
    return await asyncio.to_thread(_run_query_sync, sql, cols)


@router.get("/metrics/{film_id}/{region}")
async def metrics(
    film_id: int, region: str,
    hours: int = Query(48, ge=1, le=720),
):
    t0 = time.perf_counter()
    box, soc, sent, trail = await asyncio.gather(
        _run(_q_box_office(film_id, region, hours),
             ("ts", "revenue_usd", "tickets_sold")),
        _run(_q_social(film_id, region, hours),
             ("ts", "avg_virality", "volume")),
        _run(_q_sentiment(film_id, region, hours),
             ("ts", "avg_score", "volume")),
        _run(_q_trailer(film_id, region, hours),
             ("ts", "views", "completion_rate")),
    )
    dt_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "film_id": film_id, "region": region, "hours": hours,
        "timeseries": {
            "box_office_daily": box,
            "social_virality_hourly": soc,
            "sentiment_hourly": sent,
            "trailer_hourly": trail,
        },
        "query_latency_ms": dt_ms,
    }
