"""refresh_detections(): run all 9 detectors and INSERT into `detections`.

Called by Layer 2 CLI at build time (--since-hours 168 for the full
baseline window) and by Layer 4's /inject-crisis endpoint after each
live inject (--since-hours 1).
"""

from __future__ import annotations

import argparse
import sys
import time

from data.ch_client import client
from data.mv.detectors import (
    ewma_sql,
    pctchange_sql,
    zscore_sql,
)

# ---------------------------------------------------------------
# Per-metric detector SELECTs. Each tuple: (metric_key, sql_fragment).
# ---------------------------------------------------------------

def _metric_selects() -> list[tuple[str, str]]:
    """Return list of (metric_name, detector_sql) pairs. Spec §6.4."""
    selects: list[tuple[str, str]] = []

    # audience_sentiment.avg_score — z, ewma, pct
    sentiment_src = (
        "(SELECT film_id, region, ts, "
        " toFloat64(sum_score_weighted) / nullIf(sum_volume, 0) AS avg_score "
        " FROM roll_sentiment_hourly)"
    )
    for fn, det in [(zscore_sql, "z"), (ewma_sql, "ewma"), (pctchange_sql, "pct")]:
        selects.append(("audience_sentiment.avg_score",
                        fn("audience_sentiment.avg_score", sentiment_src, "avg_score")))

    # social_trends.avg_virality — z, pct
    social_src = (
        "(SELECT film_id, region, ts, "
        " toFloat64(sum_virality) / greatest(n, 1) AS avg_virality, "
        " toFloat64(sum_sentiment) / greatest(n, 1) AS avg_sentiment "
        " FROM roll_social_hourly)"
    )
    selects.append(("social_trends.avg_virality",
                    zscore_sql("social_trends.avg_virality", social_src, "avg_virality")))
    selects.append(("social_trends.avg_virality",
                    pctchange_sql("social_trends.avg_virality", social_src, "avg_virality")))

    # social_trends.avg_sentiment — z, pct
    selects.append(("social_trends.avg_sentiment",
                    zscore_sql("social_trends.avg_sentiment", social_src, "avg_sentiment")))
    selects.append(("social_trends.avg_sentiment",
                    pctchange_sql("social_trends.avg_sentiment", social_src, "avg_sentiment")))

    # trailer_analytics.avg_completion_rate — z, ewma (partition by variant too)
    trailer_src = (
        "(SELECT film_id, region, ts, variant, "
        " toFloat64(sum_completion_x_views) / nullIf(sum_views, 0) AS avg_completion "
        " FROM roll_trailer_hourly)"
    )
    selects.append(("trailer_analytics.avg_completion_rate",
                    zscore_sql("trailer_analytics.avg_completion_rate",
                               trailer_src, "avg_completion",
                               partition_cols="film_id, region, variant")))
    selects.append(("trailer_analytics.avg_completion_rate",
                    ewma_sql("trailer_analytics.avg_completion_rate",
                             trailer_src, "avg_completion",
                             partition_cols="film_id, region, variant")))

    # streaming.completion_ratio — z, ewma, pct
    streaming_src = (
        "(SELECT film_id, region, ts, "
        " toFloat64(sum_completions) / nullIf(sum_completions + sum_drops, 0) "
        "   AS completion_ratio "
        " FROM roll_streaming_hourly)"
    )
    for fn in (zscore_sql, ewma_sql, pctchange_sql):
        selects.append(("streaming_watch_minutes.completion_ratio",
                        fn("streaming_watch_minutes.completion_ratio",
                           streaming_src, "completion_ratio")))

    # box_office.revenue_usd — direct daily source; z, pct (daily)
    box_src = (
        "(SELECT film_id, region, toDateTime(date) AS ts, revenue_usd "
        " FROM box_office_revenue)"
    )
    selects.append(("box_office_revenue.revenue_usd",
                    zscore_sql("box_office_revenue.revenue_usd", box_src, "revenue_usd")))
    selects.append(("box_office_revenue.revenue_usd",
                    pctchange_sql("box_office_revenue.revenue_usd", box_src, "revenue_usd",
                                  prior_from=2, prior_to=2, curr_from=1, curr_to=1)))

    # ticket_refunds.refund_count — aggregated hourly from source; z, pct
    refund_src = (
        "(SELECT film_id, region, toStartOfHour(ts) AS ts, "
        " sum(refund_count) AS refund_count "
        " FROM ticket_refunds GROUP BY film_id, region, ts)"
    )
    selects.append(("ticket_refunds.refund_count",
                    zscore_sql("ticket_refunds.refund_count", refund_src, "refund_count")))
    selects.append(("ticket_refunds.refund_count",
                    pctchange_sql("ticket_refunds.refund_count", refund_src, "refund_count")))

    # marketing_roi — spend / conversions from campaign daily; pct only
    roi_src = (
        "(SELECT c.film_id AS film_id, c.region AS region, c.day AS ts, "
        " toFloat64(sum(c.sum_spend)) / greatest(sum(c.sum_conversions), 1) AS roi "
        " FROM roll_campaign_daily c "
        " GROUP BY c.film_id, c.region, c.day)"
    )
    selects.append(("marketing_roi",
                    pctchange_sql("marketing_roi", roi_src, "roi",
                                  prior_from=2, prior_to=2, curr_from=1, curr_to=1)))

    # review_scores divergence — max - min per (film_id, ts) across sources; pct
    review_src = (
        "(SELECT film_id, 'GLOBAL' AS region, ts, "
        " max(score) - min(score) AS score_gap "
        " FROM review_scores GROUP BY film_id, ts)"
    )
    selects.append(("review_scores.score_by_source_divergence",
                    pctchange_sql("review_scores.score_by_source_divergence",
                                  review_src, "score_gap")))

    return selects


def _build_detection_query(since_hours: int) -> str:
    """Wrap UNION ALL of detector fragments with the JOIN that computes
    business_impact, severity, dedup_key. Filters by since_hours cutoff."""
    unioned = "\n        UNION ALL\n".join(
        f"(SELECT * FROM (\n{sql}\n))" for _, sql in _metric_selects()
    )
    return f"""
    INSERT INTO detections
        (metric_ts, metric, film_id, region, detector,
         baseline_value, actual_value, magnitude,
         business_impact, severity, dedup_key)
    SELECT
        d.metric_ts,
        d.metric,
        d.film_id,
        d.region,
        d.detector,
        d.baseline_value,
        d.actual_value,
        d.magnitude,
        toFloat32(
            (log10(1 + coalesce(f.revenue_usd, 0)) / 10.0)
            * coalesce(w.weight, 0.05)
        )                                                       AS business_impact,
        toFloat32(abs(d.magnitude) * business_impact)           AS severity,
        concat(d.metric, '|', toString(d.film_id), '|', d.region,
               '|', toString(d.metric_ts), '|', d.detector)     AS dedup_key
    FROM (
        {unioned}
    ) AS d
    LEFT JOIN films f              ON f.film_id = d.film_id
    LEFT JOIN film_region_weight w ON w.film_id = d.film_id AND w.region = d.region
    WHERE d.metric_ts > (SELECT max(ts) FROM roll_sentiment_hourly) - INTERVAL {since_hours} HOUR
      AND d.magnitude IS NOT NULL
    """


def refresh_detections(since_hours: int = 168) -> int:
    """Refresh detections for buckets within the last `since_hours`.
    Returns count of unique dedup_keys post-refresh."""
    query = _build_detection_query(since_hours)
    with client() as c:
        t0 = time.perf_counter()
        c.command(query)
        dt = time.perf_counter() - t0
        # OPTIMIZE FINAL is not always allowed on Cloud; use FINAL in the count
        n_unique = c.query(
            "SELECT count(DISTINCT dedup_key) FROM detections "
            "WHERE metric_ts > (SELECT max(ts) FROM roll_sentiment_hourly) "
            f"- INTERVAL {since_hours} HOUR"
        ).result_rows[0][0]
    print(f"refresh_detections(since_hours={since_hours}): "
          f"query {dt*1000:.0f}ms, unique dedup_keys={n_unique:,}", file=sys.stderr)
    return int(n_unique)


def verify(since_hours: int = 168) -> None:
    with client() as c:
        total = c.query("SELECT count() FROM detections").result_rows[0][0]
        unique = c.query(
            "SELECT count(DISTINCT dedup_key) FROM detections"
        ).result_rows[0][0]
        top = c.query(
            "SELECT metric, detector, count() AS n, round(avg(severity), 3) AS sev "
            "FROM detections GROUP BY metric, detector ORDER BY n DESC LIMIT 10"
        ).result_rows
    print(f"detections: total_rows={total:,} unique_dedup_keys={unique:,}")
    print("top (metric, detector, count, avg severity):")
    for row in top:
        print(f"  {row[0]:<48} {row[1]:<10} n={row[2]:>5}  sev={row[3]}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--since-hours", type=int, default=168)
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify(args.since_hours)
        return
    refresh_detections(args.since_hours)
    verify(args.since_hours)


if __name__ == "__main__":
    main()
