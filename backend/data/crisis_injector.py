"""Perturbs telemetry tables to create realistic crises + writes ground truth.

Modes:
  - seed_historical(N): N crises with fixed past timestamps (used at Layer 1 build).
  - inject_now(...):    one crisis at now() (called by Layer 4 /inject-crisis).
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta
from typing import Iterable

from data.ch_client import client
from data.generate_numeric import WINDOW_DAYS, _film_center_date, _load_films
from data.ground_truth import Crisis, CrisisType, write as write_gt
from data.region_split import REGIONS

# scenario -> (affected_tables, root_cause_label, recommendation_label)
SCENARIO_META: dict[CrisisType, tuple[list[str], str, str]] = {
    CrisisType.REGIONAL_SENTIMENT_COLLAPSE: (
        ["audience_sentiment", "social_trends"],
        "regional audience negative reaction",
        "pause regional promotion, launch response messaging",
    ),
    CrisisType.TRAILER_VARIANT_UNDERPERFORMANCE: (
        ["trailer_analytics"],
        "variant A underperforming vs baseline",
        "pause variant A, shift traffic to variant B",
    ),
    CrisisType.COMPETITOR_RELEASE_IMPACT: (
        ["box_office_revenue", "streaming_watch_minutes"],
        "competitor opening eating share",
        "increase spend on differentiators, extend theatrical",
    ),
    CrisisType.MARKETING_OVERSPEND_LOW_ROI: (
        ["marketing_spend", "campaign_performance"],
        "spend rising, conversions flat",
        "cut spend on lowest-ROI channel by 30%",
    ),
    CrisisType.STREAMING_COMPLETION_DROP: (
        ["streaming_watch_minutes"],
        "completion rate collapsing",
        "review content quality, promote alternate title",
    ),
    CrisisType.REFUND_SPIKE: (
        ["ticket_refunds"],
        "audience-dissatisfaction refund wave",
        "issue statement, offer credit, review theater partners",
    ),
    CrisisType.NEGATIVE_SOCIAL_VIRALITY: (
        ["social_trends", "audience_sentiment"],
        "negative post going viral",
        "respond publicly, escalate PR, brief execs",
    ),
    CrisisType.REVIEW_SCORE_DIVERGENCE: (
        ["review_scores", "audience_sentiment"],
        "critics vs audience gap widening",
        "amplify audience quotes, deprioritize critic-centric ads",
    ),
}


def _pick_film(rng: random.Random) -> int:
    # ORDER BY is required for rng.choice to be reproducible — ClickHouse
    # doesn't guarantee row order without it.
    with client() as c:
        ids = [r[0] for r in c.query("SELECT film_id FROM films ORDER BY film_id").result_rows]
    if not ids:
        raise RuntimeError("No films — run seed_tmdb first.")
    return rng.choice(ids)


def _perturb(crisis: Crisis) -> None:
    """Apply table-specific perturbations for `crisis` around its timestamp.

    We insert additional rows rather than mutate baseline — MergeTree is
    append-only friendly and Detection's rolling z-score reacts to the added
    volume/direction.
    """
    ts = crisis.injection_timestamp
    fid = crisis.affected_film_id
    region = crisis.affected_region
    mag = crisis.magnitude

    with client() as c:
        for table in crisis.affected_tables:
            if table == "audience_sentiment":
                rows = [[fid, region, ts + timedelta(minutes=15 * i),
                         "aggregate", -mag, int(2000 * mag)] for i in range(1, 6)]
                c.insert("audience_sentiment", rows,
                         column_names=["film_id", "region", "ts", "platform", "score", "volume"])
            elif table == "social_trends":
                rows = [[fid, region, ts + timedelta(minutes=15 * i),
                         "twitter", int(10000 * mag), -mag, float(mag)] for i in range(1, 6)]
                c.insert("social_trends", rows,
                         column_names=["film_id", "region", "ts", "platform", "mentions", "sentiment", "virality"])
            elif table == "trailer_analytics":
                rows = [[fid * 10 + 1, fid, "A", region, ts + timedelta(hours=i),
                         int(1000 * (1 - mag)), max(0.05, 0.6 - mag), -mag] for i in range(1, 6)]
                c.insert("trailer_analytics", rows,
                         column_names=["trailer_id", "film_id", "variant", "region", "ts", "views", "completion_rate", "sentiment_score"])
            elif table == "ticket_refunds":
                rows = [[fid, region, ts + timedelta(hours=i), int(500 * mag), "quality"]
                        for i in range(1, 6)]
                c.insert("ticket_refunds", rows,
                         column_names=["film_id", "region", "ts", "refund_count", "refund_reason"])
            elif table == "streaming_watch_minutes":
                rows = [[fid, region, ts + timedelta(hours=i),
                         int(50000 * (1 - mag)), int(200 * (1 - mag)), int(1000 * mag)]
                        for i in range(1, 6)]
                c.insert("streaming_watch_minutes", rows,
                         column_names=["film_id", "region", "ts", "watch_minutes", "completions", "drops"])
            elif table == "box_office_revenue":
                rows = [[fid, region, ts.date() + timedelta(days=i),
                         int(200_000 * (1 - mag)), int(15_000 * (1 - mag)), int(500 * mag)]
                        for i in range(1, 4)]
                c.insert("box_office_revenue", rows,
                         column_names=["film_id", "region", "date", "revenue_usd", "tickets_sold", "refunds"])
            elif table == "marketing_spend":
                rows = [[fid, region, "search", ts.date() + timedelta(days=i),
                         int(100_000 * (1 + mag)), int(10_000_000 * (1 + mag)), int(150_000 * (1 - mag))]
                        for i in range(1, 4)]
                c.insert("marketing_spend", rows,
                         column_names=["film_id", "region", "channel", "date", "spend_usd", "impressions", "clicks"])
            elif table == "campaign_performance":
                rows = [[fid * 100, fid, region, "email", ts.date() + timedelta(days=i),
                         int(50_000 * (1 + mag)), int(500 * (1 - mag))]
                        for i in range(1, 4)]
                c.insert("campaign_performance", rows,
                         column_names=["campaign_id", "film_id", "region", "channel", "date", "spend_usd", "conversions"])
            elif table == "review_scores":
                rows = [[fid, "critic", ts + timedelta(hours=i), max(1.0, 5.0 - mag * 3), int(20)]
                        for i in range(1, 6)]
                c.insert("review_scores", rows,
                         column_names=["film_id", "source", "ts", "score", "review_count"])


def _build_crisis(
    rng: random.Random, is_live: bool, ts: datetime,
    force_type: CrisisType | None = None,
) -> Crisis:
    ctype = force_type or rng.choice(list(CrisisType))
    tables, cause, reco = SCENARIO_META[ctype]
    return Crisis(
        injection_timestamp=ts,
        is_live=is_live,
        type=ctype,
        affected_film_id=_pick_film(rng),
        affected_region=rng.choice(REGIONS),
        magnitude=round(rng.uniform(0.20, 0.50), 3),
        affected_tables=tables,
        true_root_cause=cause,
        expected_recommendation=reco,
        resolution_window_hours=rng.choice([12, 24, 48]),
    )


def seed_historical(n: int, seed: int = 1337) -> list[Crisis]:
    """Spread N crises within the baseline telemetry window.

    Anchoring to the film-median release date (same as generate_numeric)
    guarantees each crisis has ≥ ~30 days of baseline telemetry before it
    for Detection's rolling z-score to compare against.
    """
    rng = random.Random(seed)
    films = _load_films()
    if not films:
        raise RuntimeError("No films — run seed_tmdb first.")
    center = _film_center_date(films)
    # Place crises in the second half of the baseline window: [center, center + WINDOW_DAYS/2)
    out: list[Crisis] = []
    for i in range(n):
        days_into_second_half = rng.randint(2, WINDOW_DAYS // 2 - 2)
        crisis_date = center + timedelta(days=days_into_second_half)
        ts = datetime.combine(
            crisis_date, datetime.min.time()
        ) + timedelta(hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        c = _build_crisis(rng, is_live=False, ts=ts)
        _perturb(c)
        write_gt(c)
        out.append(c)
        print(f"  [{i+1}/{n}] {c.type.value} film={c.affected_film_id} region={c.affected_region} @ {ts}")
    return out


def inject_now(
    ctype: CrisisType | None = None,
    film_id: int | None = None,
    region: str | None = None,
    magnitude: float | None = None,
) -> Crisis:
    """Live-injection primitive (called by Layer 4 endpoint)."""
    rng = random.SystemRandom()
    now = datetime.utcnow().replace(microsecond=0)
    c = _build_crisis(rng, is_live=True, ts=now, force_type=ctype)
    if film_id is not None:
        c.affected_film_id = film_id
    if region is not None:
        c.affected_region = region
    if magnitude is not None:
        c.magnitude = magnitude
    _perturb(c)
    write_gt(c)
    return c


def verify() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM crisis_ground_truth").result_rows[0][0]
    print(f"crisis_ground_truth: {n} rows.")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--seed-historical", type=int, default=0,
                   help="Seed N historical crises")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
        return
    if args.seed_historical > 0:
        seed_historical(args.seed_historical)
        verify()
    else:
        print("Nothing to do. Use --seed-historical N or --verify.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
