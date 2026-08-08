"""Baseline telemetry generator — 10 numeric/temporal tables, ~51M rows.

Model per (film, region, day):
  daily_curve(d) = revenue_scale
                   * regional_weight[genre, region]
                   * lifecycle_factor(days_since_release)
                   * noise(seed=hash(film_id, region, table_name, d))

Hourly tables intraday-splice the daily total with a diurnal pattern.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

from data.ch_client import client, insert_batches
from data.region_split import REGIONS, weights_for

WINDOW_DAYS = 120
BATCH = 100_000


@dataclass
class Film:
    film_id: int
    genre: str
    release_date: date
    revenue_usd: int
    popularity: float


def _load_films() -> list[Film]:
    with client() as c:
        rows = c.query(
            "SELECT film_id, genre, release_date, revenue_usd, popularity FROM films"
        ).result_rows
    return [
        Film(film_id=r[0], genre=str(r[1]), release_date=r[2],
             revenue_usd=int(r[3]), popularity=float(r[4]))
        for r in rows
    ]


def _lifecycle(days_since_release: int) -> float:
    """0.05 baseline pre-release, ramp last 14 days, spike at release, exp decay."""
    if days_since_release < -14:
        return 0.05
    if days_since_release < 0:
        return 0.05 + 0.35 * (days_since_release + 14) / 14  # ramp to 0.4
    return math.exp(-days_since_release / 30) * 1.0 + 0.1


def _diurnal(hour: int) -> float:
    # Peaks 19–22h, trough 3–6h. Normalized so 24h sum = 24.
    base = 0.6 + 0.5 * math.sin((hour - 3) / 24 * 2 * math.pi)
    return base


def _film_center_date(films: list[Film]) -> date:
    # Use median release date as window "T=0", then window covers [T-60, T+60).
    dates = sorted(f.release_date for f in films)
    return dates[len(dates) // 2]


def _daily_range(center: date) -> list[date]:
    return [center + timedelta(days=d - WINDOW_DAYS // 2) for d in range(WINDOW_DAYS)]


def _noise(seed: tuple) -> float:
    r = random.Random(hash(seed))
    # log-normal noise, mean 1
    return math.exp(r.gauss(0.0, 0.08))


def _generate_box_office(films: list[Film], days: list[date]) -> list[list]:
    rows: list[list] = []
    for f in films:
        w = weights_for(f.genre)
        for region in REGIONS:
            rw = w[region]
            for d in days:
                dsr = (d - f.release_date).days
                lc = _lifecycle(dsr)
                base = max(1.0, f.revenue_usd) * rw * lc / WINDOW_DAYS
                rev = int(base * _noise((f.film_id, region, "box", d)))
                tickets = int(rev / 12)
                refunds = int(tickets * 0.01 * _noise((f.film_id, region, "refund", d)))
                rows.append([f.film_id, region, d, rev, tickets, refunds])
    return rows


def _generate_hourly(
    films: list[Film], days: list[date], table_kind: str,
) -> list[list]:
    """Emits (film_id, region, ts, ...metrics...) hourly rows for streaming/sentiment/social/trailer."""
    rows: list[list] = []
    for f in films:
        w = weights_for(f.genre)
        for region in REGIONS:
            rw = w[region]
            for d in days:
                dsr = (d - f.release_date).days
                daily = max(1.0, f.revenue_usd) * rw * _lifecycle(dsr) / WINDOW_DAYS
                for h in range(24):
                    ts = datetime.combine(d, datetime.min.time()).replace(hour=h)
                    hour_scale = _diurnal(h) / 24
                    n = _noise((f.film_id, region, table_kind, d, h))
                    if table_kind == "streaming":
                        watch = int(daily * hour_scale * 0.5 * n)
                        completions = int(watch / 90 * 0.75)
                        drops = int(watch / 90 * 0.25)
                        rows.append([f.film_id, region, ts, watch, completions, drops])
                    elif table_kind == "sentiment":
                        score = max(-1.0, min(1.0, 0.35 + 0.15 * math.sin(dsr / 7) + (n - 1) * 2))
                        vol = int(daily * hour_scale * 0.01 * n)
                        rows.append([f.film_id, region, ts, "aggregate", float(score), vol])
                    elif table_kind == "social":
                        mentions = int(daily * hour_scale * 0.02 * n)
                        sent = max(-1.0, min(1.0, 0.2 + (n - 1) * 2))
                        viral = min(1.0, mentions / 10000)
                        rows.append([f.film_id, region, ts, "twitter", mentions, float(sent), float(viral)])
                    elif table_kind == "trailer":
                        # single default variant per film here; injector adds variants
                        trailer_id = f.film_id * 10 + 1
                        views = int(daily * hour_scale * 0.3 * n)
                        crate = max(0.1, min(0.95, 0.6 + (n - 1) * 0.5))
                        sscore = max(-1.0, min(1.0, 0.4 + (n - 1) * 2))
                        rows.append([trailer_id, f.film_id, "A", region, ts, views, float(crate), float(sscore)])
    return rows


def _generate_marketing(films: list[Film], days: list[date]) -> list[list]:
    rows: list[list] = []
    channels = ["youtube", "instagram", "tiktok", "search"]
    for f in films:
        w = weights_for(f.genre)
        for region in REGIONS:
            rw = w[region]
            for ch in channels:
                for d in days:
                    dsr = (d - f.release_date).days
                    daily = max(1.0, f.revenue_usd) * rw * _lifecycle(dsr) / WINDOW_DAYS
                    n = _noise((f.film_id, region, ch, "spend", d))
                    spend = int(daily * 0.2 * n)
                    impressions = spend * 100
                    clicks = int(impressions * 0.02 * n)
                    rows.append([f.film_id, region, ch, d, spend, impressions, clicks])
    return rows


def _generate_campaign(films: list[Film], days: list[date]) -> list[list]:
    rows: list[list] = []
    channels = ["email", "display", "social", "affiliate"]
    for f in films:
        w = weights_for(f.genre)
        for region in REGIONS:
            for ch in channels:
                cid = f.film_id * 100 + hash(ch) % 100
                for d in days:
                    dsr = (d - f.release_date).days
                    daily = max(1.0, f.revenue_usd) * w[region] * _lifecycle(dsr) / WINDOW_DAYS
                    n = _noise((f.film_id, region, ch, "camp", d))
                    spend = int(daily * 0.05 * n)
                    conv = int(spend / 20 * n)
                    rows.append([cid, f.film_id, region, ch, d, spend, conv])
    return rows


def _generate_refunds(films: list[Film], days: list[date]) -> list[list]:
    rows: list[list] = []
    reasons = ["quality", "duplicate", "sold_out", "other"]
    for f in films:
        w = weights_for(f.genre)
        for region in REGIONS:
            for d in days:
                if (d - f.release_date).days < 0:
                    continue  # no refunds pre-release
                dsr = (d - f.release_date).days
                daily = max(1.0, f.revenue_usd) * w[region] * _lifecycle(dsr) / WINDOW_DAYS
                for reason in reasons:
                    n = _noise((f.film_id, region, reason, d))
                    rc = int(daily / 12 * 0.01 * n)
                    ts = datetime.combine(d, datetime.min.time())
                    rows.append([f.film_id, region, ts, rc, reason])
    return rows


def _generate_review_scores(films: list[Film], days: list[date]) -> list[list]:
    rows: list[list] = []
    sources = ["imdb", "rotten_tomatoes", "letterboxd"]
    for f in films:
        for src in sources:
            for d in days:
                dsr = (d - f.release_date).days
                if dsr < -3:
                    continue
                n = _noise((f.film_id, src, d))
                score = max(1.0, min(10.0, 6.5 + (n - 1) * 3))
                rc = int(50 + dsr * 3) if dsr > 0 else 0
                if rc > 0:
                    ts = datetime.combine(d, datetime.min.time())
                    rows.append([f.film_id, src, ts, float(score), rc])
    return rows


def _generate_competitors(films: list[Film]) -> list[list]:
    rows: list[list] = []
    rng = random.Random(7)
    ids = [f.film_id for f in films]
    for f in films:
        for region in REGIONS:
            # 0–2 competitors per film per region
            for _ in range(rng.randint(0, 2)):
                competitor = rng.choice(ids)
                if competitor == f.film_id:
                    continue
                offset = rng.randint(-14, 14)
                rows.append([
                    f.film_id, region,
                    f.release_date + timedelta(days=offset),
                    competitor,
                ])
    return rows


# ---- driver ----

TABLE_JOBS = [
    ("box_office_revenue", ["film_id", "region", "date", "revenue_usd", "tickets_sold", "refunds"], _generate_box_office, "daily"),
    ("streaming_watch_minutes", ["film_id", "region", "ts", "watch_minutes", "completions", "drops"], lambda films, days: _generate_hourly(films, days, "streaming"), "hourly"),
    ("audience_sentiment", ["film_id", "region", "ts", "platform", "score", "volume"], lambda films, days: _generate_hourly(films, days, "sentiment"), "hourly"),
    ("social_trends", ["film_id", "region", "ts", "platform", "mentions", "sentiment", "virality"], lambda films, days: _generate_hourly(films, days, "social"), "hourly"),
    ("trailer_analytics", ["trailer_id", "film_id", "variant", "region", "ts", "views", "completion_rate", "sentiment_score"], lambda films, days: _generate_hourly(films, days, "trailer"), "hourly"),
    ("marketing_spend", ["film_id", "region", "channel", "date", "spend_usd", "impressions", "clicks"], _generate_marketing, "daily"),
    ("campaign_performance", ["campaign_id", "film_id", "region", "channel", "date", "spend_usd", "conversions"], _generate_campaign, "daily"),
    ("ticket_refunds", ["film_id", "region", "ts", "refund_count", "refund_reason"], _generate_refunds, "daily"),
    ("review_scores", ["film_id", "source", "ts", "score", "review_count"], _generate_review_scores, "daily"),
    ("competitor_releases", ["film_id", "region", "release_date", "competitor_film_id"], lambda films, days: _generate_competitors(films), "static"),
]


def run(only: str | None = None) -> None:
    films = _load_films()
    if not films:
        print("No films seeded. Run seed_tmdb first.", file=sys.stderr)
        sys.exit(1)
    center = _film_center_date(films)
    days = _daily_range(center)

    for table, cols, gen, kind in TABLE_JOBS:
        if only and only != table:
            continue
        print(f"Generating {table} ({kind}) ...")
        rows = gen(films, days)
        print(f"  {len(rows):,} rows; inserting ...")
        with client() as c:
            c.command(f"TRUNCATE TABLE {table}")
        n = insert_batches(table, rows, cols, batch_size=BATCH)
        print(f"  inserted {n:,} into {table}")


def verify() -> None:
    with client() as c:
        total = 0
        for table, _, _, _ in TABLE_JOBS:
            n = c.query(f"SELECT count() FROM {table}").result_rows[0][0]
            print(f"  {table:30s} {n:>12,}")
            total += n
    print(f"TOTAL: {total:,}")
    if total < 50_000_000:
        print(f"WARN: total {total:,} < 50M target", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--only", help="Generate only one table")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
    else:
        run(only=args.only)
        verify()


if __name__ == "__main__":
    main()
