"""GET /metrics/{film_id}/{region} — 4 parallel rollup timeseries."""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Query

from data.ch_client import client


router = APIRouter(tags=["reads"])


# NOTE: We alias `toString(ts)` to `ts_str` (not `ts`) — the new ClickHouse
# analyzer resolves `WHERE ts >= now() - INTERVAL H HOUR` against the SELECT
# alias, turning it into `String >= DateTime` and raising NO_COMMON_TYPE.
# The JSON key stays "ts" because _run_query_sync maps columns positionally
# via the `cols` tuple, not by SQL alias name.
#
# DATA-ANCHOR: synthetic seed data is anchored ~60d in the past, so
# `now() - INTERVAL H HOUR` / `today() - INTERVAL D DAY` returns zero rows
# and every Telemetry sparkline shows "no data". Each query anchors its
# window to coalesce(max(ts|date), now()|today()) of the underlying table
# for this (film, region), same pattern as api/catalog/shelves.py and the
# decision-action impact templates.


def _q_box_office(film_id: int, region: str, hours: int) -> str:
    days = max(1, hours // 24)
    return (
        f"SELECT toString(date) AS ts_str, revenue_usd, tickets_sold "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue "
        f"    WHERE film_id = {film_id} AND region = '{region}'),"
        f"  today()) - INTERVAL {days} DAY "
        f"ORDER BY date"
    )


def _q_social(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts_str, "
        f"sum_virality / greatest(n, 1) AS avg_virality, "
        f"n AS volume "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly "
        f"    WHERE film_id = {film_id} AND region = '{region}'),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _q_sentiment(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts_str, "
        f"sum_score_weighted / greatest(sum_volume, 1) AS avg_score, "
        f"sum_volume AS volume "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly "
        f"    WHERE film_id = {film_id} AND region = '{region}'),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _q_trailer(film_id: int, region: str, hours: int) -> str:
    return (
        f"SELECT toString(ts) AS ts_str, sum_views AS views, "
        f"sum_completion_x_views / greatest(sum_views, 1) AS completion_rate "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} AND region = '{region}' "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly "
        f"    WHERE film_id = {film_id} AND region = '{region}'),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"ORDER BY ts"
    )


def _run_query_sync(sql: str, cols: tuple[str, ...]) -> list[dict]:
    with client() as c:
        rows = c.query(sql).result_rows
    return [dict(zip(cols, r)) for r in rows]


async def _run(sql: str, cols: tuple[str, ...]) -> list[dict]:
    return await asyncio.to_thread(_run_query_sync, sql, cols)


# Canonical 15 regions — must match backend/data/generate_numeric.py::REGIONS.
# Kept explicit here so a missing region in one rollup table doesn't drop the
# tile from the heat bar (invariant: always 15 tiles).
_CANONICAL_REGIONS = (
    "NA", "LATAM", "UK", "EU-West", "EU-East", "Nordics",
    "India", "SEA", "Korea", "Japan", "China", "MENA",
    "Africa", "ANZ", "Brazil",
)

# Anomaly threshold: signal is "anomalous" when |delta_pct| >= this.
# Kept modest — the heat bar's job is to draw the eye toward regions
# worth clicking, not to duplicate the detection agent's judgement.
_ANOMALY_DELTA_PCT = 15.0


def _q_regions_agg(film_id: int, hours: int) -> tuple[str, str, str, str]:
    days = max(1, hours // 24)
    box = (
        f"SELECT region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id = {film_id}),"
        f"  today()) - INTERVAL {days} DAY "
        f"GROUP BY region"
    )
    soc = (
        f"SELECT region, sum(n) AS vol "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"GROUP BY region"
    )
    rev = (
        f"SELECT region, sum(sum_volume) AS vol "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"GROUP BY region"
    )
    stream = (
        f"SELECT region, sum(sum_views) AS vol "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"GROUP BY region"
    )
    return box, soc, rev, stream


def _q_regions_baseline_agg(film_id: int, hours: int) -> tuple[str, str, str, str]:
    """Same shape as _q_regions_agg but over the previous window of equal
    length, immediately before the current window. Used to compute delta_pct."""
    days = max(1, hours // 24)
    box = (
        f"SELECT region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id = {film_id} "
        f"AND date < coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id = {film_id}),"
        f"  today()) - INTERVAL {days} DAY "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id = {film_id}),"
        f"  today()) - INTERVAL {2 * days} DAY "
        f"GROUP BY region"
    )
    soc = (
        f"SELECT region, sum(n) AS vol "
        f"FROM roll_social_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts < coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_social_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {2 * hours} HOUR "
        f"GROUP BY region"
    )
    rev = (
        f"SELECT region, sum(sum_volume) AS vol "
        f"FROM roll_sentiment_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts < coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_sentiment_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {2 * hours} HOUR "
        f"GROUP BY region"
    )
    stream = (
        f"SELECT region, sum(sum_views) AS vol "
        f"FROM roll_trailer_hourly "
        f"WHERE film_id = {film_id} "
        f"AND ts < coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {hours} HOUR "
        f"AND ts >= coalesce("
        f"  (SELECT max(ts) FROM roll_trailer_hourly WHERE film_id = {film_id}),"
        f"  now()) - INTERVAL {2 * hours} HOUR "
        f"GROUP BY region"
    )
    return box, soc, rev, stream


def _q_open_investigations(film_id: int) -> str:
    return (
        f"SELECT region, count() FROM decision_audit FINAL "
        f"WHERE film_id = {film_id} AND approval_status = 'pending_approval' "
        f"GROUP BY region"
    )


def _run_map_sync(sql: str) -> dict[str, float]:
    with client() as c:
        rows = c.query(sql).result_rows
    out: dict[str, float] = {}
    for row in rows:
        code = str(row[0])
        val = float(row[1]) if row[1] is not None else 0.0
        out[code] = val
    return out


async def _run_map(sql: str) -> dict[str, float]:
    return await asyncio.to_thread(_run_map_sync, sql)


def _delta_pct(cur: float, prev: float) -> float:
    if prev <= 0.0:
        return 0.0 if cur <= 0.0 else 100.0
    return round(((cur - prev) / prev) * 100.0, 2)


@router.get("/metrics/{film_id}/regions")
async def metrics_regions(
    film_id: int,
    hours: int = Query(168, ge=1, le=720),
):
    t0 = time.perf_counter()
    box_sql, soc_sql, rev_sql, stream_sql = _q_regions_agg(film_id, hours)
    b_box_sql, b_soc_sql, b_rev_sql, b_stream_sql = _q_regions_baseline_agg(film_id, hours)
    (box_cur, soc_cur, rev_cur, stream_cur,
     box_prev, soc_prev, rev_prev, stream_prev,
     inv_map) = await asyncio.gather(
        _run_map(box_sql), _run_map(soc_sql), _run_map(rev_sql), _run_map(stream_sql),
        _run_map(b_box_sql), _run_map(b_soc_sql), _run_map(b_rev_sql), _run_map(b_stream_sql),
        _run_map(_q_open_investigations(film_id)),
    )
    families = (
        ("box_office", box_cur, box_prev),
        ("social",     soc_cur, soc_prev),
        ("reviews",    rev_cur, rev_prev),
        ("streaming",  stream_cur, stream_prev),
    )
    regions_out: list[dict] = []
    for code in _CANONICAL_REGIONS:
        signals: dict[str, dict] = {}
        for name, cur_map, prev_map in families:
            cur = cur_map.get(code, 0.0)
            prev = prev_map.get(code, 0.0)
            delta = _delta_pct(cur, prev)
            signals[name] = {
                "volume": int(cur),
                "delta_pct": delta,
                "anomaly": abs(delta) >= _ANOMALY_DELTA_PCT and cur > 0,
            }
        regions_out.append({
            "code": code,
            "signals": signals,
            "open_investigation": inv_map.get(code, 0.0) > 0,
        })
    dt_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "film_id": film_id,
        "hours": hours,
        "regions": regions_out,
        "query_latency_ms": dt_ms,
    }


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
