# Layer 2 — Detection Design

**Status:** approved 2026-08-08
**Depends on:** Layer 1 (Data Foundation) complete — 250 films, 48.2M numeric rows, 12 baseline-window-aligned crises in `crisis_ground_truth`.
**Blocks:** Layer 3 (Investigation Agent will query `detections` via mcp-clickhouse).

---

## 1. Purpose

Convert continuous telemetry into a stream of actionable anomaly rows the Investigation Agent can consume. Detection is **pure ClickHouse SQL** with **zero LLM** — provably deterministic, sub-second, and the ClickHouse-track flex judges recognize.

## 2. Rules of the layer

- **No LLM.** Only ClickHouse SQL. An LLM here would be slower, non-deterministic, and would undercut the exact story we tell judges.
- **Direct `clickhouse-connect` access is allowed** for this layer's setup and refresh code (Layer 1/2 boundary rule from `data/ch_client.py`). Agents (Layer 3+) never touch `ch_client` — they use mcp-clickhouse.
- **Idempotent setup.** `apply.py` can be re-run at will; `--reset --yes` drops and rebuilds.
- **Deterministic refresh.** Two consecutive `refresh_detections()` calls produce the same `detections` table state (via `ReplacingMergeTree` dedup).

## 3. Architecture

Two-stage:

```
Layer 1 tables ──MV──▶ rollup tables ──detection query──▶ detections table
                       (SummingMergeTree,               (ReplacingMergeTree,
                        hourly-bucketed,                 dedup on natural key)
                        derived per-bucket metrics)
```

- **Rollup MVs** stream continuously as new telemetry lands (this is the "database detects live" narrative). They compute *derived* per-bucket metrics — not 1:1 copies — so they earn their keep.
- **Detection query** is a `SELECT ... FROM UNION ALL of per-detector queries` that produces candidate detection rows. `refresh_detections()` wraps it in `INSERT INTO detections SELECT ...`.
- **`detections` table** is queried by Layer 3's Investigation Agent through mcp-clickhouse and by Layer 4's `/detections` endpoint directly.

Rollup MVs are chosen only where they add value:
- Hourly source tables get hourly rollups with *derived* metrics (e.g., `completion_ratio = completions / (completions + drops)`).
- Daily source tables (`box_office_revenue`, `ticket_refunds`, `review_scores`) are queried directly — a 1:1 rollup adds nothing.

## 4. Files

```
backend/data/mv/
├── __init__.py
├── ddl.sql        # rollup tables, MVs, detections table
├── apply.py       # idempotent applier — --reset --yes, --verify
├── refresh.py     # refresh_detections() function + CLI
└── README.md      # Layer 2 runbook (prerequisites, one-shot, verify, reset)
```

## 5. Data model

### 5.1 Rollup tables (6)

All `SummingMergeTree`. Hourly rollups: `PARTITION BY toYYYYMM(ts)`, `ORDER BY (film_id, region, ts)`. Daily rollups: bucket column is `day` (Date), `PARTITION BY toYYYYMM(day)`, `ORDER BY (film_id, region, channel, day)`. Overrides called out per row.

| Rollup | Source | Bucket | Columns |
|---|---|---|---|
| `roll_sentiment_hourly` | `audience_sentiment` | hour (`ts`) | `film_id, region, ts, sum_score_weighted, sum_volume` — avg = `sum_score_weighted / sum_volume` |
| `roll_social_hourly` | `social_trends` | hour (`ts`) | `film_id, region, ts, sum_sentiment, sum_virality, sum_mentions, n` |
| `roll_trailer_hourly` | `trailer_analytics` | hour (`ts`) | `trailer_id, film_id, region, variant, ts, sum_views, sum_completion_x_views, sum_sentiment_x_views` — `avg_completion = sum_completion_x_views / sum_views`; **ORDER BY = `(film_id, region, variant, ts)`** |
| `roll_streaming_hourly` | `streaming_watch_minutes` | hour (`ts`) | `film_id, region, ts, sum_watch, sum_completions, sum_drops` — `completion_ratio = sum_completions / (sum_completions + sum_drops)` |
| `roll_marketing_daily` | `marketing_spend` | day (`day` Date) | `film_id, region, channel, day, sum_spend, sum_impressions, sum_clicks` |
| `roll_campaign_daily` | `campaign_performance` | day (`day` Date) | `film_id, region, channel, day, sum_spend, sum_conversions` — joined with `roll_marketing_daily` in detection query for ROI |

### 5.2 Materialized views (6)

Each MV: `CREATE MATERIALIZED VIEW mv_<name> TO roll_<name> AS SELECT ... FROM <source> GROUP BY ...`. MVs are stateless per-block; `SummingMergeTree` handles cross-block aggregation on merge. Reads use `SUM()` + `GROUP BY` (or `FINAL` for smoke checks).

### 5.3 `detections` table

```sql
CREATE TABLE detections (
    detection_id     UUID DEFAULT generateUUIDv4(),
    fired_at         DateTime64(3) DEFAULT now64(3),
    metric_ts        DateTime,                        -- bucket that triggered
    metric           LowCardinality(String),          -- e.g. 'audience_sentiment.score'
    film_id          UInt64,
    region           LowCardinality(String),
    detector         LowCardinality(String),          -- 'zscore' | 'ewma' | 'pctchange'
    baseline_value   Float64,
    actual_value     Float64,
    magnitude        Float32,                         -- z-value, %-change, or normalized ewma dev
    business_impact  Float32,                         -- log-revenue × region-share weight
    severity         Float32,                         -- |magnitude| × business_impact
    dedup_key        String                           -- concat(metric, film_id, region, metric_ts, detector)
) ENGINE = ReplacingMergeTree(fired_at)
ORDER BY (metric, film_id, region, metric_ts, detector);
```

`dedup_key` is *derived* but stored explicitly so a `SELECT DISTINCT dedup_key` reveals unique fires without `FINAL`.

## 6. Detectors (SQL)

All three implemented as window queries over rollup or source tables.

### 6.1 Z-score
Baseline: last 24 preceding buckets.
```sql
WITH rolled AS (
    SELECT film_id, region, ts, actual_value,
           avg(actual_value)  OVER win AS baseline_mean,
           stddevPop(actual_value) OVER win AS baseline_std
    FROM (SELECT film_id, region, ts, SUM(metric_col) AS actual_value
          FROM roll_xxx GROUP BY film_id, region, ts)
    WINDOW win AS (PARTITION BY film_id, region ORDER BY ts
                   ROWS BETWEEN 24 PRECEDING AND 1 PRECEDING)
)
SELECT film_id, region, ts, actual_value, baseline_mean,
       (actual_value - baseline_mean) / nullIf(baseline_std, 0) AS z
FROM rolled
WHERE abs(z) >= 3.0;
```
Fires: `magnitude = z`, `baseline_value = baseline_mean`, `actual_value = actual_value`.

### 6.2 EWMA
α = 0.3.
ClickHouse doesn't have a native EWMA window function. Approximation: use `exponentialMovingAverage(nsamples)(value, index)` if available, or compute inline with `arrayReduce`:
```sql
SELECT film_id, region, ts, actual_value,
       arrayReduce('avg',
         arrayMap((v, i) -> v * pow(0.7, greatest(0, position - i)),
                  window_values, arrayEnumerate(window_values)))
         AS ewma_value
FROM ...
```
Fire when `|actual - ewma| / greatest(abs(ewma), 1e-6) > 0.4`.
Fires: `magnitude = (actual - ewma) / ewma`, `baseline_value = ewma`.

### 6.3 %-change
Compare current 6h to prior 6h (or current day to prior day for daily metrics).
```sql
WITH windows AS (
    SELECT film_id, region, ts,
           actual_value,
           sum(actual_value) OVER (PARTITION BY film_id, region ORDER BY ts
                                    ROWS BETWEEN 12 PRECEDING AND 7 PRECEDING) AS prior_6h,
           sum(actual_value) OVER (PARTITION BY film_id, region ORDER BY ts
                                    ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS current_6h
    FROM ...
)
SELECT ..., (current_6h - prior_6h) / nullIf(prior_6h, 0) AS pct_change
WHERE abs(pct_change) > 0.30
```
Fires: `magnitude = pct_change`, `baseline_value = prior_6h`, `actual_value = current_6h`.

### 6.4 Metric coverage

Nine metrics mapped to crisis types the injector generates. Detection query is the UNION of these:

| Metric | Source | Detectors run | Crisis types it catches |
|---|---|---|---|
| `audience_sentiment.avg_score` | `roll_sentiment_hourly` | z, ewma, pct | regional_sentiment_collapse, negative_social_virality |
| `social_trends.avg_virality` | `roll_social_hourly` | z, pct | negative_social_virality |
| `social_trends.avg_sentiment` | `roll_social_hourly` | z, pct | regional_sentiment_collapse |
| `trailer_analytics.avg_completion_rate` | `roll_trailer_hourly` (per variant) | z, ewma | trailer_variant_underperformance |
| `streaming_watch_minutes.completion_ratio` | `roll_streaming_hourly` | z, ewma, pct | streaming_completion_drop |
| `box_office_revenue.revenue_usd` | `box_office_revenue` (direct) | z, pct | competitor_release_impact |
| `ticket_refunds.refund_count` | `ticket_refunds` (direct, aggregated hourly) | z, pct | refund_spike |
| `marketing_roi` | `roll_marketing_daily ⋈ roll_campaign_daily` | pct (spend/conv ratio) | marketing_overspend_low_roi |
| `review_scores.score_by_source_divergence` | `review_scores` (direct) | pct (max - min per film) | review_score_divergence |

Nine metrics total (roughly 1 per crisis type + a couple with overlap for redundancy).

## 7. Severity ranking

`business_impact(film, region)` computed inline via JOIN:

```sql
log10(1 + films.revenue_usd) / 10 AS revenue_weight     -- roughly 0.6 – 0.9
```
Region share is a small dim lookup we materialize once into a `film_region_weight` reference table populated at layer-2 setup time from `data.region_split.weights_for(genre)`. Weight = `revenue_weight × region_share`, roughly 0.02–0.30.

`severity = abs(magnitude) × business_impact` — Layer 3 orders `detections` by severity DESC to prioritize.

Why materialize `film_region_weight`? So the detection query doesn't recompute genre-based weights per row (they're static per film×region and Python is authoritative for them).

```sql
CREATE TABLE film_region_weight (
    film_id       UInt64,
    region        LowCardinality(String),
    weight        Float32
) ENGINE = ReplacingMergeTree() ORDER BY (film_id, region);
```
Populated by `apply.py` from `films × REGIONS` iterating `region_split.weights_for(f.genre)`.

## 8. refresh_detections()

Signature (`data/mv/refresh.py`):
```python
def refresh_detections(since_hours: int = 168) -> int:
    """Refresh detections for buckets within the last `since_hours`.
    Returns count of unique dedup_keys inserted (post-dedup).
    """
```

- Runs one `INSERT INTO detections (metric_ts, metric, film_id, region, detector,
  baseline_value, actual_value, magnitude, business_impact, severity, dedup_key)
  SELECT ... FROM ( <UNION ALL of per-detector queries> ) WHERE metric_ts > now() - INTERVAL X HOUR`.
- `dedup_key` computed in the SELECT so `ReplacingMergeTree` collapses re-runs.
- Query time logged to stderr (for the "sub-second on 50M rows" story).
- CLI: `python -m data.mv.refresh --since-hours 168 --verify`.

Default `since_hours=168` (7 days) matches the baseline-window crises. Layer 4's `/inject-crisis` endpoint calls `refresh_detections(since_hours=1)` after each inject.

## 9. Boundary rule

- `data/mv/apply.py` and `data/mv/refresh.py` import from `data.ch_client` — allowed (Layer 2 is inside the boundary).
- Neither module is importable from `backend/agents/` or `backend/mcp/`. This is verified by grep in Layer 3's code review.
- `refresh_detections()` is Python; it's called from Layer 4 (which sits above agents but below UI). Layer 4 imports it via `from data.mv.refresh import refresh_detections`. This is the *only* higher-layer import of Layer 2 Python code — allowed because Layer 4 is orchestration and needs to trigger post-inject refresh.

## 10. Acceptance criteria

After Layer 2 build against the existing Layer 1 data:

1. `apply.py --verify` prints: 6 MVs exist, 6 rollup tables exist, `detections` table exists, `film_region_weight` populated (3,750 rows = 250 × 15).
2. Rollup tables non-empty (populated automatically by MVs from Layer 1's existing data through the MV backfill mechanism, which requires either re-inserting source data or a one-time backfill INSERT).
3. `refresh.py` runs in < 5 seconds wall-clock; logs the ClickHouse query time (target < 500ms).
4. `detections` table has ≥ 20 rows (12 crises × 1-3 detectors each = ~24 fires).
5. For ≥ 10 of the 12 seeded crises: at least one detection row exists with matching `film_id`, `region`, and `metric_ts` within ±6 h of `crisis_ground_truth.injection_timestamp`.
6. Two consecutive `refresh.py` runs produce the same `SELECT count(DISTINCT dedup_key) FROM detections`.
7. Grep: `ch_client` is imported only from files under `backend/data/`. Same for `clickhouse_connect`.

## 11. Non-goals

- Real-time streaming ingestion into rollups (they exist, but Layer 1's data is bulk-loaded; MVs populate on future INSERTs, and a one-time backfill covers historical data).
- Tuning thresholds beyond initial calibration against 12 seeded crises.
- The Detection Agent (Python + ADK) — that's Layer 3.
- Layer 4's `/inject-crisis` endpoint wiring `refresh_detections` — this doc names the callable, Layer 4 wires it.

## 12. Risks

- **MV backfill.** MVs only populate on new INSERTs, not historical rows. Layer 2's `apply.py` must do a one-time `INSERT INTO roll_X SELECT ... FROM source_X` after creating each MV to backfill.
- **Threshold miscalibration.** 3.0 z-score / 0.4 ewma / 30% may miss weak crises (magnitude 0.20) or spam on baseline noise. Verify against the 12 seeded crises and adjust in `refresh.py` constants once.
- **EWMA in ClickHouse.** No native window function; the `arrayReduce` approximation is fine but ugly. If ClickHouse Cloud version supports `exponentialMovingAverage`, prefer it.
- **Boundary drift.** Someone Later™ imports `ch_client` from an agent module. Enforced by grep in code review.

## 13. Rollout

- Build in isolation on `main` (no branch — matches Layer 1 pattern).
- Small commits per subtask (apply → refresh → verify → README).
- Final code review after all subtasks land (matches Layer 1 subagent-driven-development flow).
