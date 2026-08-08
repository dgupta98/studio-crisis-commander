"""SQL fragments per detector, one per (metric, algorithm) pair.

Each fragment returns rows with columns:
    metric_ts, metric, film_id, region, detector,
    baseline_value, actual_value, magnitude
The orchestrator wraps the UNION ALL with JOINs to add
business_impact, severity, and dedup_key, then inserts.

Thresholds live here as module constants so calibration is one edit.
"""

from __future__ import annotations

Z_THRESHOLD = 3.0        # z-score |z| >= this fires
EWMA_ALPHA = 0.3
EWMA_THRESHOLD = 0.4     # normalized dev |Δ/ewma| > this fires
PCT_THRESHOLD = 0.30     # 30% change fires


def zscore_sql(metric_name: str, source_table: str, value_expr: str,
               partition_cols: str = "film_id, region") -> str:
    """Rolling z-score over 24 preceding buckets (excludes current)."""
    return f"""
    SELECT
        ts                                                      AS metric_ts,
        '{metric_name}'                                         AS metric,
        film_id,
        region,
        'zscore'                                                AS detector,
        avg({value_expr})       OVER win                        AS baseline_value,
        {value_expr}                                            AS actual_value,
        toFloat32(({value_expr} - avg({value_expr}) OVER win)
            / nullIf(stddevPop({value_expr}) OVER win, 0))      AS magnitude
    FROM (
        SELECT film_id, region, ts, {value_expr}
        FROM {source_table}
    )
    WINDOW win AS (PARTITION BY {partition_cols} ORDER BY ts
                   ROWS BETWEEN 24 PRECEDING AND 1 PRECEDING)
    QUALIFY abs(magnitude) >= {Z_THRESHOLD}
    """


def ewma_sql(metric_name: str, source_table: str, value_expr: str,
             partition_cols: str = "film_id, region") -> str:
    """EWMA (α=0.3) approximated with arrayReduce over last 24 buckets.

    ClickHouse doesn't ship a native EWMA window function, so we
    materialize the trailing 24 values per row and fold with weights
    (1-α)^i. `nsamples=24` is generous — weight at i=24 is ~0.0002.
    """
    alpha = EWMA_ALPHA
    decay = 1.0 - alpha
    return f"""
    WITH windowed AS (
        SELECT film_id, region, ts, {value_expr} AS v,
               arraySlice(
                   groupArray({value_expr}) OVER (
                       PARTITION BY {partition_cols} ORDER BY ts
                       ROWS BETWEEN 24 PRECEDING AND 1 PRECEDING
                   ), 1) AS prior_vals
        FROM (SELECT film_id, region, ts, {value_expr} FROM {source_table})
    )
    SELECT
        ts                                       AS metric_ts,
        '{metric_name}'                          AS metric,
        film_id,
        region,
        'ewma'                                   AS detector,
        arraySum(
          (v, i) -> v * pow({decay}, length(prior_vals) - i),
          prior_vals, arrayEnumerate(prior_vals)
        ) / greatest(arraySum(
          (i) -> pow({decay}, length(prior_vals) - i),
          arrayEnumerate(prior_vals)
        ), 1e-9)                                 AS baseline_value,
        v                                        AS actual_value,
        toFloat32((v - baseline_value) / greatest(abs(baseline_value), 1e-6))
                                                 AS magnitude
    FROM windowed
    WHERE length(prior_vals) >= 6      -- need warm-up
      AND abs((v - baseline_value) / greatest(abs(baseline_value), 1e-6)) > {EWMA_THRESHOLD}
    """


def pctchange_sql(metric_name: str, source_table: str, value_expr: str,
                  partition_cols: str = "film_id, region",
                  prior_from: int = 12, prior_to: int = 7,
                  curr_from: int = 6, curr_to: int = 1) -> str:
    """Current window vs prior window %-change.

    Defaults: current = last 6 buckets, prior = the 6 before that.
    For daily-grained metrics call with prior_from=2, prior_to=2, curr_from=1, curr_to=1
    (i.e., compare today to yesterday).
    """
    return f"""
    SELECT
        ts                                                 AS metric_ts,
        '{metric_name}'                                    AS metric,
        film_id,
        region,
        'pctchange'                                        AS detector,
        sum({value_expr}) OVER win_prior                   AS baseline_value,
        sum({value_expr}) OVER win_curr                    AS actual_value,
        toFloat32((sum({value_expr}) OVER win_curr - sum({value_expr}) OVER win_prior)
                  / nullIf(sum({value_expr}) OVER win_prior, 0)) AS magnitude
    FROM (SELECT film_id, region, ts, {value_expr} FROM {source_table})
    WINDOW win_prior AS (PARTITION BY {partition_cols} ORDER BY ts
                         ROWS BETWEEN {prior_from} PRECEDING AND {prior_to} PRECEDING),
           win_curr  AS (PARTITION BY {partition_cols} ORDER BY ts
                         ROWS BETWEEN {curr_from} PRECEDING AND {curr_to} PRECEDING)
    QUALIFY abs(magnitude) > {PCT_THRESHOLD}
    """
