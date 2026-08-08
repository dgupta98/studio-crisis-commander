# Layer 2 — Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-SQL detection layer that converts Layer 1's 48M-row telemetry into a ranked `detections` stream the Investigation Agent (Layer 3) will consume.

**Architecture:** Six `SummingMergeTree` rollup tables fed by materialized views compute per-hour or per-day derived metrics from Layer 1 sources. A `refresh_detections()` Python function runs a single `INSERT ... SELECT` that UNIONs nine per-metric detectors (z-score, EWMA, %-change) over the rollups + daily source tables, writing candidate anomaly rows into a `ReplacingMergeTree` `detections` table keyed by `(metric, film_id, region, metric_ts, detector)` for deterministic dedup. Severity is `|magnitude| × business_impact` where `business_impact` comes from a pre-materialized `film_region_weight` table.

**Tech Stack:** ClickHouse Cloud (via `clickhouse-connect`), Python 3.12, existing `data.ch_client` wrapper, `data.region_split.weights_for()`. No LLM. No new external deps.

**Testing convention:** Layer 1 established a `--verify` idempotent smoke-check per module (no pytest). Layer 2 follows the same pattern — each module ships `verify()` that queries ClickHouse and asserts. A final acceptance-sweep task validates all 6 spec acceptance criteria end-to-end.

**Spec:** `docs/superpowers/specs/2026-08-08-layer-2-detection-design.md` (read once before starting).

---

## File Structure

```
backend/data/mv/
├── __init__.py          # empty package marker
├── ddl.sql              # 6 rollup tables, 6 MVs, film_region_weight, detections table
├── apply.py             # idempotent DDL applier; populates film_region_weight; --reset --yes, --verify
├── backfill.py          # one-shot MV backfill: INSERT INTO roll_X SELECT ... FROM source_X
├── detectors.py         # SQL fragments for z-score, EWMA, %-change per metric
├── refresh.py           # refresh_detections(since_hours) + CLI
└── README.md            # Layer 2 runbook
```

**Boundary rule (rules-critical):** every module above imports `from data.ch_client import client` — this is the *only* place outside `backend/data/*.py` where `ch_client` is allowed. Verified by grep in Task 10.

---

## Task 1: Package scaffold + DDL for rollup tables

**Files:**
- Create: `backend/data/mv/__init__.py`
- Create: `backend/data/mv/ddl.sql`

- [ ] **Step 1: Create package marker**

Write `backend/data/mv/__init__.py` with exactly this content:

```python
"""Layer 2 — Detection.

Rollup materialized views + on-demand SQL detectors that produce
the `detections` stream consumed by Layer 3's Investigation Agent.

BOUNDARY: This package imports `data.ch_client` directly. It must
never be imported from `backend/agents/` or `backend/mcp/`.
"""
```

- [ ] **Step 2: Write `ddl.sql` with the 6 rollup tables**

Create `backend/data/mv/ddl.sql`:

```sql
-- Studio Crisis Commander — Layer 2 DDL.
-- Rollup tables (SummingMergeTree), materialized views,
-- film_region_weight reference table, and detections table.

------------------------------------------------------------
-- Rollup tables — hourly
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roll_sentiment_hourly (
    film_id             UInt64,
    region              LowCardinality(String),
    ts                  DateTime,
    sum_score_weighted  Float64,
    sum_volume          UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS roll_social_hourly (
    film_id        UInt64,
    region         LowCardinality(String),
    ts             DateTime,
    sum_sentiment  Float64,
    sum_virality   Float64,
    sum_mentions   UInt64,
    n              UInt32
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS roll_trailer_hourly (
    trailer_id                 UInt64,
    film_id                    UInt64,
    region                     LowCardinality(String),
    variant                    LowCardinality(String),
    ts                         DateTime,
    sum_views                  UInt64,
    sum_completion_x_views     Float64,
    sum_sentiment_x_views      Float64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, variant, ts);

CREATE TABLE IF NOT EXISTS roll_streaming_hourly (
    film_id          UInt64,
    region           LowCardinality(String),
    ts               DateTime,
    sum_watch        UInt64,
    sum_completions  UInt64,
    sum_drops        UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

------------------------------------------------------------
-- Rollup tables — daily
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roll_marketing_daily (
    film_id          UInt64,
    region           LowCardinality(String),
    channel          LowCardinality(String),
    day              Date,
    sum_spend        UInt64,
    sum_impressions  UInt64,
    sum_clicks       UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (film_id, region, channel, day);

CREATE TABLE IF NOT EXISTS roll_campaign_daily (
    film_id          UInt64,
    region           LowCardinality(String),
    channel          LowCardinality(String),
    day              Date,
    sum_spend        UInt64,
    sum_conversions  UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (film_id, region, channel, day);

------------------------------------------------------------
-- Reference: per-film per-region business weight (250 * 15 = 3,750 rows).
-- Populated by apply.py from data.region_split.weights_for(genre).
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS film_region_weight (
    film_id  UInt64,
    region   LowCardinality(String),
    weight   Float32
) ENGINE = ReplacingMergeTree()
ORDER BY (film_id, region);

------------------------------------------------------------
-- Detections — ReplacingMergeTree so re-runs collapse on natural key.
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detections (
    detection_id     UUID DEFAULT generateUUIDv4(),
    fired_at         DateTime64(3) DEFAULT now64(3),
    metric_ts        DateTime,
    metric           LowCardinality(String),
    film_id          UInt64,
    region           LowCardinality(String),
    detector         LowCardinality(String),
    baseline_value   Float64,
    actual_value     Float64,
    magnitude        Float32,
    business_impact  Float32,
    severity         Float32,
    dedup_key        String
) ENGINE = ReplacingMergeTree(fired_at)
ORDER BY (metric, film_id, region, metric_ts, detector);
```

- [ ] **Step 3: Commit**

```bash
git add backend/data/mv/__init__.py backend/data/mv/ddl.sql
git commit -m "mv: scaffold layer 2 package + rollup/detection DDL"
```

---

## Task 2: `apply.py` — idempotent DDL applier + `film_region_weight` population

**Files:**
- Create: `backend/data/mv/apply.py`

- [ ] **Step 1: Write `apply.py`**

Create `backend/data/mv/apply.py`:

```python
"""Apply Layer 2 DDL and populate film_region_weight.

Idempotent. `--reset --yes` drops the 8 layer-2 objects first.
`--verify` prints the row counts required by acceptance criterion 1.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from data.ch_client import client
from data.region_split import REGIONS, weights_for

DDL_PATH = Path(__file__).parent / "ddl.sql"

ROLLUP_TABLES = [
    "roll_sentiment_hourly",
    "roll_social_hourly",
    "roll_trailer_hourly",
    "roll_streaming_hourly",
    "roll_marketing_daily",
    "roll_campaign_daily",
]

MV_NAMES = [
    "mv_sentiment_hourly",
    "mv_social_hourly",
    "mv_trailer_hourly",
    "mv_streaming_hourly",
    "mv_marketing_daily",
    "mv_campaign_daily",
]

OTHER_TABLES = ["film_region_weight", "detections"]


def _split_statements(sql: str) -> list[str]:
    stripped = re.sub(r"--[^\n]*", "", sql)
    return [s.strip() for s in stripped.split(";") if s.strip()]


def apply(reset: bool) -> None:
    sql = DDL_PATH.read_text()
    with client() as c:
        if reset:
            for mv in MV_NAMES:
                c.command(f"DROP VIEW IF EXISTS {mv}")
            for t in ROLLUP_TABLES + OTHER_TABLES:
                c.command(f"DROP TABLE IF EXISTS {t}")
            print(f"Dropped {len(MV_NAMES)} MVs + {len(ROLLUP_TABLES) + len(OTHER_TABLES)} tables.")
        for stmt in _split_statements(sql):
            c.command(stmt)
    populate_film_region_weight()
    verify()


def populate_film_region_weight() -> None:
    """Compute (film_id, region, weight) rows from films × REGIONS × genre affinity."""
    with client() as c:
        films = [(int(r[0]), str(r[1])) for r in
                 c.query("SELECT film_id, genre FROM films").result_rows]
        rows = []
        for fid, genre in films:
            w = weights_for(genre)
            for region in REGIONS:
                rows.append([fid, region, float(w[region])])
        c.command("TRUNCATE TABLE film_region_weight")
        c.insert("film_region_weight", rows,
                 column_names=["film_id", "region", "weight"])
    print(f"film_region_weight: {len(rows):,} rows written.")


def verify() -> None:
    expected_tables = set(ROLLUP_TABLES + OTHER_TABLES)
    with client() as c:
        present_tables = {r[0] for r in c.query("SHOW TABLES").result_rows}
        # MVs show up in SHOW TABLES too; check separately for clarity
        missing_tables = expected_tables - present_tables
        missing_mvs = [mv for mv in MV_NAMES if mv not in present_tables]
        weight_n = c.query("SELECT count() FROM film_region_weight").result_rows[0][0]
    if missing_tables:
        print(f"MISSING tables: {sorted(missing_tables)}", file=sys.stderr)
        sys.exit(1)
    print(f"Layer 2 DDL OK: {len(expected_tables)} tables present, "
          f"{len(MV_NAMES) - len(missing_mvs)}/{len(MV_NAMES)} MVs present, "
          f"film_region_weight={weight_n:,} rows.")
    if missing_mvs:
        print(f"(MVs not yet created: {missing_mvs} — expected until Task 4 lands.)")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true")
    p.add_argument("--yes", action="store_true")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
        return
    if args.reset and not args.yes:
        print("--reset requires --yes", file=sys.stderr)
        sys.exit(2)
    apply(reset=args.reset)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run and verify**

Run from `backend/`:
```
./venv/bin/python -m data.mv.apply
```

Expected output:
```
film_region_weight: 3,750 rows written.
Layer 2 DDL OK: 8 tables present, 0/6 MVs present, film_region_weight=3,750 rows.
(MVs not yet created: [...] — expected until Task 4 lands.)
```

- [ ] **Step 3: Commit**

```bash
git add backend/data/mv/apply.py
git commit -m "mv: apply.py — idempotent DDL + film_region_weight populate"
```

---

## Task 3: Materialized views (append to `ddl.sql`) + re-apply

**Files:**
- Modify: `backend/data/mv/ddl.sql` (append 6 MV `CREATE MATERIALIZED VIEW` statements)

- [ ] **Step 1: Append MVs to `ddl.sql`**

Append this block to the end of `backend/data/mv/ddl.sql`:

```sql
------------------------------------------------------------
-- Materialized views — feed the rollup tables on every INSERT
-- into the source tables. Historical rows are backfilled by
-- backfill.py (Task 4).
------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_sentiment_hourly
TO roll_sentiment_hourly AS
SELECT
    film_id,
    region,
    toStartOfHour(ts)         AS ts,
    sum(score * volume)       AS sum_score_weighted,
    sum(volume)               AS sum_volume
FROM audience_sentiment
GROUP BY film_id, region, toStartOfHour(ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_social_hourly
TO roll_social_hourly AS
SELECT
    film_id,
    region,
    toStartOfHour(ts)  AS ts,
    sum(sentiment)     AS sum_sentiment,
    sum(virality)      AS sum_virality,
    sum(mentions)      AS sum_mentions,
    count()            AS n
FROM social_trends
GROUP BY film_id, region, toStartOfHour(ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trailer_hourly
TO roll_trailer_hourly AS
SELECT
    trailer_id,
    film_id,
    region,
    variant,
    toStartOfHour(ts)               AS ts,
    sum(views)                      AS sum_views,
    sum(completion_rate * views)    AS sum_completion_x_views,
    sum(sentiment_score * views)    AS sum_sentiment_x_views
FROM trailer_analytics
GROUP BY trailer_id, film_id, region, variant, toStartOfHour(ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_streaming_hourly
TO roll_streaming_hourly AS
SELECT
    film_id,
    region,
    toStartOfHour(ts)  AS ts,
    sum(watch_minutes) AS sum_watch,
    sum(completions)   AS sum_completions,
    sum(drops)         AS sum_drops
FROM streaming_watch_minutes
GROUP BY film_id, region, toStartOfHour(ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_marketing_daily
TO roll_marketing_daily AS
SELECT
    film_id,
    region,
    channel,
    date               AS day,
    sum(spend_usd)     AS sum_spend,
    sum(impressions)   AS sum_impressions,
    sum(clicks)        AS sum_clicks
FROM marketing_spend
GROUP BY film_id, region, channel, date;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_campaign_daily
TO roll_campaign_daily AS
SELECT
    film_id,
    region,
    channel,
    date               AS day,
    sum(spend_usd)     AS sum_spend,
    sum(conversions)   AS sum_conversions
FROM campaign_performance
GROUP BY film_id, region, channel, date;
```

- [ ] **Step 2: Re-apply DDL to create MVs**

Run:
```
./venv/bin/python -m data.mv.apply --reset --yes
```

Expected output tail:
```
Layer 2 DDL OK: 8 tables present, 6/6 MVs present, film_region_weight=3,750 rows.
```
(no "MVs not yet created" line)

- [ ] **Step 3: Sanity-check rollup tables are empty**

Run in `backend/`:
```
./venv/bin/python -c "from data.ch_client import client
with client() as c:
    for t in ['roll_sentiment_hourly','roll_social_hourly','roll_trailer_hourly','roll_streaming_hourly','roll_marketing_daily','roll_campaign_daily']:
        n = c.query(f'SELECT count() FROM {t}').result_rows[0][0]
        print(f'{t}: {n:,}')"
```

Expected: all six print `0` (MVs only fire on future INSERTs; backfill is Task 4).

- [ ] **Step 4: Commit**

```bash
git add backend/data/mv/ddl.sql
git commit -m "mv: materialized views for 6 rollup tables"
```

---

## Task 4: `backfill.py` — one-shot historical backfill for the 6 rollups

**Files:**
- Create: `backend/data/mv/backfill.py`

Why a separate module: MVs only fire on new INSERTs. Historical Layer 1 rows (48M of them) never touched the MVs, so the rollup tables stay empty until we manually replay. This script is a one-shot; after Layer 4 wires `refresh_detections` to `/inject-crisis`, all new data flows through MVs automatically.

- [ ] **Step 1: Write `backfill.py`**

Create `backend/data/mv/backfill.py`:

```python
"""One-shot: replay Layer 1 historical rows into the rollup tables.

MVs only fire on future INSERTs. This module runs the equivalent
SELECT-GROUP-BY against the existing source data and INSERTs into
each rollup. Idempotent: TRUNCATE before INSERT so re-runs are safe.
"""

from __future__ import annotations

import argparse
import sys
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
        GROUP BY film_id, region, toStartOfHour(ts)
    """),
    ("roll_social_hourly", """
        SELECT film_id, region, toStartOfHour(ts) AS ts,
               sum(sentiment) AS sum_sentiment,
               sum(virality)  AS sum_virality,
               sum(mentions)  AS sum_mentions,
               count()        AS n
        FROM social_trends
        GROUP BY film_id, region, toStartOfHour(ts)
    """),
    ("roll_trailer_hourly", """
        SELECT trailer_id, film_id, region, variant, toStartOfHour(ts) AS ts,
               sum(views)                     AS sum_views,
               sum(completion_rate * views)   AS sum_completion_x_views,
               sum(sentiment_score * views)   AS sum_sentiment_x_views
        FROM trailer_analytics
        GROUP BY trailer_id, film_id, region, variant, toStartOfHour(ts)
    """),
    ("roll_streaming_hourly", """
        SELECT film_id, region, toStartOfHour(ts) AS ts,
               sum(watch_minutes) AS sum_watch,
               sum(completions)   AS sum_completions,
               sum(drops)         AS sum_drops
        FROM streaming_watch_minutes
        GROUP BY film_id, region, toStartOfHour(ts)
    """),
    ("roll_marketing_daily", """
        SELECT film_id, region, channel, date AS day,
               sum(spend_usd)   AS sum_spend,
               sum(impressions) AS sum_impressions,
               sum(clicks)      AS sum_clicks
        FROM marketing_spend
        GROUP BY film_id, region, channel, date
    """),
    ("roll_campaign_daily", """
        SELECT film_id, region, channel, date AS day,
               sum(spend_usd)   AS sum_spend,
               sum(conversions) AS sum_conversions
        FROM campaign_performance
        GROUP BY film_id, region, channel, date
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
```

- [ ] **Step 2: Run the backfill**

Run from `backend/`:
```
./venv/bin/python -m data.mv.backfill
```

Expected output (approximate row counts — depends on Layer 1 data volume):
```
  roll_sentiment_hourly: 4,300,000 rows in ~10s
  roll_social_hourly: 4,300,000 rows in ~10s
  roll_trailer_hourly: 8,600,000 rows in ~20s
  roll_streaming_hourly: 4,300,000 rows in ~10s
  roll_marketing_daily: 450,000 rows in ~2s
  roll_campaign_daily: 450,000 rows in ~2s
backfill complete: 22,400,000 rollup rows.
```

Order-of-magnitude only. If a row count is 0, the source table is empty (Layer 1 didn't run) — stop and fix Layer 1 first.

- [ ] **Step 3: Commit**

```bash
git add backend/data/mv/backfill.py
git commit -m "mv: backfill.py — one-shot historical replay into rollups"
```

---

## Task 5: `detectors.py` — SQL fragments for z-score, EWMA, %-change

Every detector emits a `SELECT` that produces columns matching the `detections` insert target:
```
metric_ts, metric, film_id, region, detector,
baseline_value, actual_value, magnitude, business_impact, severity, dedup_key
```
The orchestrator in Task 6 will UNION ALL these fragments inside a single `INSERT INTO detections ... SELECT ...`.

`business_impact` and `severity` are computed **once** in the orchestrator's outer wrapper — detectors emit only `(magnitude, baseline_value, actual_value)` and metadata; the orchestrator joins `film_region_weight` and `films` to compute the rest. Detectors return `INNER_SELECT` strings.

**Files:**
- Create: `backend/data/mv/detectors.py`

- [ ] **Step 1: Write `detectors.py`**

Create `backend/data/mv/detectors.py`:

```python
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
```

- [ ] **Step 2: Import-smoke the module**

Run from `backend/`:
```
./venv/bin/python -c "from data.mv.detectors import zscore_sql, ewma_sql, pctchange_sql; print(len(zscore_sql('m','t','v')), len(ewma_sql('m','t','v')), len(pctchange_sql('m','t','v')))"
```

Expected: three integers > 100 printed (the SQL bodies are populated).

- [ ] **Step 3: Commit**

```bash
git add backend/data/mv/detectors.py
git commit -m "mv: detectors.py — z-score, EWMA, %-change SQL fragments"
```

---

## Task 6: `refresh.py` — orchestrator + CLI

**Files:**
- Create: `backend/data/mv/refresh.py`

`refresh_detections()` is the entry point Layer 4 will import. It builds a UNION ALL of nine per-metric detector queries, wraps them with the film/weight JOIN that produces `business_impact` and `severity`, appends `dedup_key`, and INSERTs into `detections`. Two consecutive runs produce identical `ReplacingMergeTree` state because `dedup_key` is deterministic per `(metric, film_id, region, metric_ts, detector)`.

The 9 metrics are enumerated inline in `_build_detection_query` — spec §6.4 is the source of truth.

- [ ] **Step 1: Write `refresh.py`**

Create `backend/data/mv/refresh.py`:

```python
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
        " FROM ticket_refunds GROUP BY film_id, region, toStartOfHour(ts))"
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
    WHERE d.metric_ts > now() - INTERVAL {since_hours} HOUR
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
            f"WHERE metric_ts > now() - INTERVAL {since_hours} HOUR"
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
```

- [ ] **Step 2: First refresh — sanity check**

Run from `backend/`:
```
./venv/bin/python -m data.mv.refresh --since-hours 168
```

Expected on stderr:
```
refresh_detections(since_hours=168): query <5000ms, unique dedup_keys=NN
```
Expected on stdout: `detections: total_rows=..., unique_dedup_keys=...` and a top-10 table.

If the query fails with a ClickHouse SQL error (typically `QUALIFY` unsupported, or `groupArray OVER` window semantics), see Troubleshooting in Task 7's README section — most likely fix is replacing `QUALIFY` with a `HAVING` after a subquery wrap, or splitting the offending detector into a 2-CTE version.

- [ ] **Step 3: Determinism check (spec acceptance §6)**

Run again:
```
./venv/bin/python -m data.mv.refresh --since-hours 168 --verify
NUNIQUE_A=$(./venv/bin/python -c "from data.ch_client import client
with client() as c:
    print(c.query('SELECT count(DISTINCT dedup_key) FROM detections').result_rows[0][0])")
./venv/bin/python -m data.mv.refresh --since-hours 168
NUNIQUE_B=$(./venv/bin/python -c "from data.ch_client import client
with client() as c:
    print(c.query('SELECT count(DISTINCT dedup_key) FROM detections').result_rows[0][0])")
echo "before=$NUNIQUE_A after=$NUNIQUE_B"
```

Expected: `before` and `after` are equal integers (ReplacingMergeTree dedup made the second refresh a no-op semantically).

- [ ] **Step 4: Commit**

```bash
git add backend/data/mv/refresh.py
git commit -m "mv: refresh_detections() orchestrator + CLI"
```

---

## Task 7: Threshold calibration + acceptance sweep

Spec acceptance criterion §5 requires **≥ 10 of 12 seeded crises detected within ±6h**. This task runs the check, and if we miss the bar, lowers `Z_THRESHOLD` / `EWMA_THRESHOLD` / `PCT_THRESHOLD` in `detectors.py` by one step (Z 3.0→2.5, EWMA 0.40→0.30, PCT 0.30→0.20) until the bar is met — then re-verifies determinism.

**Files:**
- Create: `backend/data/mv/acceptance.py`
- Possibly modify: `backend/data/mv/detectors.py` (threshold constants only)

- [ ] **Step 1: Write `acceptance.py`**

Create `backend/data/mv/acceptance.py`:

```python
"""Layer 2 acceptance sweep — verifies all 7 spec acceptance criteria.

Exit code 0 if all pass, 1 otherwise. Prints one line per criterion.
"""

from __future__ import annotations

import subprocess
import sys
import time

from data.ch_client import client
from data.mv.apply import MV_NAMES, OTHER_TABLES, ROLLUP_TABLES
from data.mv.refresh import refresh_detections

MATCH_WINDOW_HOURS = 6
CRISIS_HIT_TARGET = 10   # ≥10 of 12


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def check_1_ddl() -> None:
    with client() as c:
        present = {r[0] for r in c.query("SHOW TABLES").result_rows}
        weight_n = c.query("SELECT count() FROM film_region_weight").result_rows[0][0]
    missing_tables = set(ROLLUP_TABLES + OTHER_TABLES) - present
    missing_mvs = [mv for mv in MV_NAMES if mv not in present]
    if missing_tables or missing_mvs:
        _fail(f"missing tables={missing_tables} mvs={missing_mvs}")
    if weight_n != 3750:
        _fail(f"film_region_weight has {weight_n} rows, expected 3,750")
    print(f"PASS §1: 6 rollups + 6 MVs + 2 tables present, film_region_weight={weight_n:,}")


def check_2_rollups_nonempty() -> None:
    with client() as c:
        for name in ROLLUP_TABLES:
            n = c.query(f"SELECT count() FROM {name}").result_rows[0][0]
            if n == 0:
                _fail(f"{name} is empty — run data.mv.backfill")
    print("PASS §2: all 6 rollups non-empty")


def check_3_refresh_speed() -> None:
    t0 = time.perf_counter()
    refresh_detections(since_hours=168)
    dt = time.perf_counter() - t0
    if dt > 5.0:
        _fail(f"refresh took {dt:.2f}s, spec target < 5.0s")
    print(f"PASS §3: refresh_detections() wall time {dt:.2f}s")


def check_4_detection_rows() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM detections").result_rows[0][0]
    if n < 20:
        _fail(f"detections has only {n} rows, spec target >= 20")
    print(f"PASS §4: detections has {n:,} rows")


def check_5_crisis_recall() -> int:
    """Count how many seeded crises have a matching detection within ±6h."""
    with client() as c:
        crises = c.query("""
            SELECT affected_film_id, affected_region, injection_timestamp
            FROM crisis_ground_truth FINAL
            WHERE is_live = 0
        """).result_rows
        hits = 0
        for fid, region, ts in crises:
            q = f"""
            SELECT count() FROM detections
            WHERE film_id = {int(fid)}
              AND region = '{region}'
              AND abs(dateDiff('hour', metric_ts, toDateTime('{ts}'))) <= {MATCH_WINDOW_HOURS}
            """
            n = c.query(q).result_rows[0][0]
            if n > 0:
                hits += 1
    print(f"§5 crisis recall: {hits}/{len(crises)} crises matched within ±{MATCH_WINDOW_HOURS}h")
    return hits


def check_6_determinism() -> None:
    with client() as c:
        before = c.query(
            "SELECT count(DISTINCT dedup_key) FROM detections"
        ).result_rows[0][0]
    refresh_detections(since_hours=168)
    with client() as c:
        after = c.query(
            "SELECT count(DISTINCT dedup_key) FROM detections"
        ).result_rows[0][0]
    if before != after:
        _fail(f"non-deterministic: before={before} after={after}")
    print(f"PASS §6: two consecutive refreshes → {after:,} unique dedup keys (equal)")


def check_7_boundary_grep() -> None:
    """Any file importing ch_client or clickhouse_connect outside backend/data/ is a violation."""
    r = subprocess.run(
        ["grep", "-rEln", r"(from data\.ch_client|import clickhouse_connect)",
         "backend/", "--include=*.py",
         "--exclude-dir=venv", "--exclude-dir=__pycache__"],
        capture_output=True, text=True, check=False,
    )
    bad = [p for p in r.stdout.strip().split("\n")
           if p and not p.startswith("backend/data/")]
    if bad:
        _fail(f"boundary violation — ch_client imported outside data/: {bad}")
    print("PASS §7: ch_client/clickhouse_connect imported only from backend/data/")


def main() -> None:
    check_1_ddl()
    check_2_rollups_nonempty()
    check_3_refresh_speed()
    check_4_detection_rows()
    hits = check_5_crisis_recall()
    if hits < CRISIS_HIT_TARGET:
        _fail(f"crisis recall {hits}/12 below target {CRISIS_HIT_TARGET}/12 — "
              "lower thresholds in detectors.py or investigate missed crises")
    print(f"PASS §5: crisis recall {hits}/12 >= {CRISIS_HIT_TARGET}/12")
    check_6_determinism()
    check_7_boundary_grep()
    print("\nAll Layer 2 acceptance checks PASSED.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the sweep**

Run from `backend/`:
```
./venv/bin/python -m data.mv.acceptance
```

Expected: seven `PASS §N` lines and a final `All Layer 2 acceptance checks PASSED.`

If §5 fails with `crisis recall K/12 below target 10/12`:

- [ ] **Step 3 (conditional): Lower thresholds one step**

Edit `backend/data/mv/detectors.py`, changing exactly these three lines:

```python
Z_THRESHOLD = 2.5        # was 3.0
EWMA_THRESHOLD = 0.30    # was 0.40
PCT_THRESHOLD = 0.20     # was 0.30
```

Truncate detections and re-run:
```
./venv/bin/python -c "from data.ch_client import client
with client() as c: c.command('TRUNCATE TABLE detections')"
./venv/bin/python -m data.mv.acceptance
```

If still failing, escalate — do **not** keep lowering thresholds silently (spam risk defeats Layer 3). Print detections for the missed crisis and share with the controller.

- [ ] **Step 4: Commit**

If thresholds unchanged:
```bash
git add backend/data/mv/acceptance.py
git commit -m "mv: acceptance sweep for 7 layer-2 criteria"
```

If thresholds were lowered:
```bash
git add backend/data/mv/acceptance.py backend/data/mv/detectors.py
git commit -m "mv: acceptance sweep + threshold calibration for 10/12 crisis recall"
```

---

## Task 8: `README.md` — Layer 2 runbook

**Files:**
- Create: `backend/data/mv/README.md`

- [ ] **Step 1: Write the README**

Create `backend/data/mv/README.md`:

```markdown
# Layer 2 — Detection

This directory owns the ClickHouse **materialized views** that continuously
roll Layer 1 telemetry into per-hour or per-day derived metrics, plus the
`refresh_detections()` function that runs nine pure-SQL detectors
(z-score, EWMA, %-change) over those rollups and writes anomaly rows into
the `detections` table.

**Zero LLM in the detection hot path** — determinism and speed are the
whole point.

## Boundary rule

`apply.py`, `backfill.py`, `refresh.py`, and `acceptance.py` all import
`data.ch_client` directly. This is allowed because Layer 2 sits inside
the Layer-1/2 boundary. Agents (Layer 3+) never touch `ch_client` — they
query ClickHouse through the `mcp-clickhouse` MCP server.

Acceptance criterion §7 greps to enforce this.

## Prerequisites

- Layer 1 build complete (250 films, ~48M numeric rows, 12 crises in
  `crisis_ground_truth`). See `backend/data/README.md`.
- Same `.env` used by Layer 1 — no new secrets.

## One-shot build sequence

Run from `backend/`:

```bash
# 1. Create rollup tables, MVs, film_region_weight, detections
./venv/bin/python -m data.mv.apply

# 2. Backfill rollups from Layer 1 historical rows (MVs only fire on new INSERTs)
./venv/bin/python -m data.mv.backfill

# 3. Refresh detections for the baseline window (7 days)
./venv/bin/python -m data.mv.refresh --since-hours 168

# 4. Run the acceptance sweep — 7 checks, all must PASS
./venv/bin/python -m data.mv.acceptance
```

Steps 1 and 2 are minutes; step 3 should be well under 5 seconds
(query time logged to stderr).

## Resetting

```bash
./venv/bin/python -m data.mv.apply --reset --yes
./venv/bin/python -m data.mv.backfill
./venv/bin/python -m data.mv.refresh --since-hours 168
```

`--reset --yes` drops the six MVs, six rollups, `film_region_weight`,
and `detections`, then re-applies. Layer 1 tables are untouched.

## Verification

Each module has a `--verify` mode that queries ClickHouse and prints
row counts / status.

```bash
./venv/bin/python -m data.mv.apply --verify
./venv/bin/python -m data.mv.backfill --verify
./venv/bin/python -m data.mv.refresh --verify
./venv/bin/python -m data.mv.acceptance    # full sweep
```

## Data model at a glance

| Table | Engine | Grain | Rows |
|---|---|---|---|
| `roll_sentiment_hourly` | SummingMergeTree | film × region × hour | ~4M |
| `roll_social_hourly` | SummingMergeTree | film × region × hour | ~4M |
| `roll_trailer_hourly` | SummingMergeTree | trailer × film × region × variant × hour | ~9M |
| `roll_streaming_hourly` | SummingMergeTree | film × region × hour | ~4M |
| `roll_marketing_daily` | SummingMergeTree | film × region × channel × day | ~450K |
| `roll_campaign_daily` | SummingMergeTree | film × region × channel × day | ~450K |
| `film_region_weight` | ReplacingMergeTree | film × region | 3,750 |
| `detections` | ReplacingMergeTree | metric × film × region × ts × detector | grows with refreshes |

## Compliance notes

- **No LLM in this layer.** Grep confirms: no import of `google.genai`,
  `openai`, `anthropic`, or any model provider.
- **Agent path uses mcp-clickhouse.** `ch_client` is used only in this
  directory and `backend/data/` — enforced by acceptance §7.
- **Deterministic.** Two consecutive `refresh_detections()` calls
  produce identical `count(DISTINCT dedup_key)`.

## Troubleshooting

- **`QUALIFY` unsupported** — some ClickHouse Cloud versions require
  `SELECT ... FROM (SELECT ...) WHERE abs(magnitude) >= X` instead.
  Edit `detectors.py`, wrap the detector body in a subquery, and move
  the `QUALIFY` predicate to an outer `WHERE`.
- **`crisis_ground_truth` empty at `--verify`** — Layer 1's crisis
  injector wasn't run. `python -m data.crisis_injector --seed-historical 12`.
- **Rollup rows = 0 after backfill** — source Layer 1 table is empty.
  Fix Layer 1 first (`python -m data.generate_numeric`).
- **Acceptance §5 crisis recall below 10/12** — Task 7 Step 3 covers
  a one-step threshold lowering. Beyond that, investigate the specific
  missed crisis type in `detections` and add or reshape a detector.
- **`refresh_detections()` > 5s** — inspect `EXPLAIN PIPELINE` on the
  built query for a missing partition prune, or reduce the source
  SELECT scope with a tighter `WHERE metric_ts >= ...` inside each
  detector fragment.
```

- [ ] **Step 2: Commit**

```bash
git add backend/data/mv/README.md
git commit -m "docs: layer 2 runbook (build sequence, verify, troubleshoot)"
```

---

## Task 9: Final acceptance verification against fresh state

**Files:** none (verification only)

- [ ] **Step 1: Reset and rebuild from scratch**

Run from `backend/`:
```
./venv/bin/python -m data.mv.apply --reset --yes
./venv/bin/python -m data.mv.backfill
./venv/bin/python -m data.mv.refresh --since-hours 168
./venv/bin/python -m data.mv.acceptance
```

Expected: seven `PASS §N` lines from the acceptance sweep and a final `All Layer 2 acceptance checks PASSED.`

- [ ] **Step 2: Capture a `detections` sample for handoff to Layer 3**

Run:
```
./venv/bin/python -c "
from data.ch_client import client
with client() as c:
    rows = c.query('''
        SELECT metric, detector, film_id, region, metric_ts,
               round(magnitude, 3) AS magnitude,
               round(severity, 4) AS severity
        FROM detections
        ORDER BY severity DESC
        LIMIT 20
    ''').result_rows
    for r in rows: print(r)
"
```

Expected: 20 rows of the top-severity detections. These are the anomalies Layer 3's Investigation Agent will start with. Eyeball for sanity — the top-severity rows should include film_ids and regions matching the seeded crises.

- [ ] **Step 3: Nothing to commit — Layer 2 complete**

Report to controller: acceptance PASS + top-20 sample.

---

## Notes for the implementer

- **ClickHouse SQL quirks to watch for.** `QUALIFY` may not be available on all ClickHouse Cloud versions. If a detector fails with a parser error, wrap the detector body in `SELECT * FROM (...) WHERE abs(magnitude) >= T`. Same fix works for the `HAVING`-vs-`WHERE`-over-window ambiguity. See Task 8 troubleshooting.
- **The `arrayReduce` EWMA in `detectors.py`** uses `arraySum` with a per-element weight computed against `arrayEnumerate`. This is one of the trickier SQL fragments in the plan — smoke-test it isolated (`SELECT ... FROM roll_sentiment_hourly LIMIT 5`) before wiring it through the orchestrator if you hit issues.
- **Do NOT** add any LLM call anywhere in `backend/data/mv/` — the whole point of this layer is that judges can see it's pure SQL.
- **Do NOT** create tests under `backend/tests/`; Layer 1's `--verify` convention is authoritative.
- **Do NOT** copy code from any prior project — new code only (RULES_COMPLIANCE.md).
- Commit after every task. If a task's ClickHouse behavior surprises you, stop and ask the controller before mutating the plan.
