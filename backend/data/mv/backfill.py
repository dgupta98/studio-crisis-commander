"""One-shot: replay Layer 1 historical rows into the rollup tables.

MVs only fire on future INSERTs. This module runs the equivalent
SELECT-GROUP-BY against the existing source data and INSERTs into
each rollup. Idempotent: TRUNCATE before INSERT so re-runs are safe.

NOTE: GROUP BY uses the SELECT alias (e.g. `ts`, `day`) — required
by ClickHouse's new analyzer when the expression is aliased. These
SELECTs must stay in sync with the MV definitions in ddl.sql.
"""

from __future__ import annotations

import argparse
import time

from data.ch_client import client

# (rollup_table, backfill_select) pairs. SELECT clauses must match
# the MV definitions in ddl.sql exactly — if you edit one, edit both.
BACKFILLS: list[tuple[str, str]] = [
    ("roll_sentiment_hourly", """
        SELECT film_id, region, toStartOfHour(ts) AS ts,
               sum(score * volume) AS sum_score_weighted,
               sum(volume)         AS sum_volume
        FROM audience_sentiment
        GROUP BY film_id, region, ts
    """),
    ("roll_social_hourly", """
        SELECT film_id, region, toStartOfHour(ts) AS ts,
               sum(sentiment) AS sum_sentiment,
               sum(virality)  AS sum_virality,
               sum(mentions)  AS sum_mentions,
               count()        AS n
        FROM social_trends
        GROUP BY film_id, region, ts
    """),
    ("roll_trailer_hourly", """
        SELECT trailer_id, film_id, region, variant, toStartOfHour(ts) AS ts,
               sum(views)                     AS sum_views,
               sum(completion_rate * views)   AS sum_completion_x_views,
               sum(sentiment_score * views)   AS sum_sentiment_x_views
        FROM trailer_analytics
        GROUP BY trailer_id, film_id, region, variant, ts
    """),
    ("roll_streaming_hourly", """
        SELECT film_id, region, toStartOfHour(ts) AS ts,
               sum(watch_minutes) AS sum_watch,
               sum(completions)   AS sum_completions,
               sum(drops)         AS sum_drops
        FROM streaming_watch_minutes
        GROUP BY film_id, region, ts
    """),
    ("roll_marketing_daily", """
        SELECT film_id, region, channel, date AS day,
               sum(spend_usd)   AS sum_spend,
               sum(impressions) AS sum_impressions,
               sum(clicks)      AS sum_clicks
        FROM marketing_spend
        GROUP BY film_id, region, channel, day
    """),
    ("roll_campaign_daily", """
        SELECT film_id, region, channel, date AS day,
               sum(spend_usd)   AS sum_spend,
               sum(conversions) AS sum_conversions
        FROM campaign_performance
        GROUP BY film_id, region, channel, day
    """),
]


def backfill_one(name: str, select_sql: str) -> int:
    with client() as c:
        c.command(f"TRUNCATE TABLE {name}")
        t0 = time.perf_counter()
        c.command(f"INSERT INTO {name} {select_sql}")
        dt = time.perf_counter() - t0
        n = c.query(f"SELECT count() FROM {name}").result_rows[0][0]
    print(f"  {name}: {n:,} rows in {dt:.2f}s")
    if n == 0:
        raise RuntimeError(f"{name}: INSERT produced 0 rows — source table empty or wrong DB context?")
    return n


def run() -> None:
    total = 0
    for name, sql in BACKFILLS:
        total += backfill_one(name, sql)
    print(f"backfill complete: {total:,} rollup rows.")


def verify() -> None:
    with client() as c:
        for name, _ in BACKFILLS:
            n = c.query(f"SELECT count() FROM {name}").result_rows[0][0]
            print(f"  {name}: {n:,}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
    else:
        run()


if __name__ == "__main__":
    main()
