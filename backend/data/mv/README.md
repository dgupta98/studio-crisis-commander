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

# 3. Refresh detections over the crisis span (~60 days = 1440 h)
./venv/bin/python -m data.mv.refresh --since-hours 1440

# 4. Run the acceptance sweep — 7 checks, all must PASS
./venv/bin/python -m data.mv.acceptance
```

Step 2 backfills ~34M rollup rows in ~30 seconds. Step 3 takes ~25–30
seconds on ClickHouse Cloud Mini (12GB) — the query is dominated by
window-function compute over 33M rollup rows, so wall time is roughly
independent of `--since-hours`.

Layer 4's live-inject path calls `refresh_detections(since_hours=6)`
after each inject; determinism (see §6 below) makes re-firing safe.

## Resetting

```bash
./venv/bin/python -m data.mv.apply --reset --yes
./venv/bin/python -m data.mv.backfill
./venv/bin/python -m data.mv.refresh --since-hours 1440
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
./venv/bin/python -m data.mv.acceptance    # full 7-check sweep
```

## Data model at a glance

| Table | Engine | Grain | Rows (post-backfill) |
|---|---|---|---|
| `roll_sentiment_hourly` | SummingMergeTree | film × region × hour | ~5.3M |
| `roll_social_hourly` | SummingMergeTree | film × region × hour | ~10.8M |
| `roll_trailer_hourly` | SummingMergeTree | trailer × film × region × variant × hour | ~7.5M |
| `roll_streaming_hourly` | SummingMergeTree | film × region × hour | ~7.6M |
| `roll_marketing_daily` | SummingMergeTree | film × region × channel × day | ~1.3M |
| `roll_campaign_daily` | SummingMergeTree | film × region × channel × day | ~1.3M |
| `film_region_weight` | ReplacingMergeTree | film × region | 3,750 |
| `detections` | ReplacingMergeTree | metric × film × region × ts × detector | ~8M after full-span refresh |

## Compliance notes

- **No LLM in this layer.** No import of `google.genai`, `openai`,
  `anthropic`, or any model provider anywhere in `backend/data/mv/`.
- **Agent path uses mcp-clickhouse.** `ch_client` is used only in this
  directory and `backend/data/` — enforced by acceptance §7.
- **Deterministic.** Two consecutive `refresh_detections()` calls with
  the same `since_hours` produce identical `count(DISTINCT dedup_key)`.
  The `dedup_key` is `concat(metric, film_id, region, metric_ts, detector)`
  so the underlying `ReplacingMergeTree` collapses duplicates on merge.

## Troubleshooting

- **§5 crisis recall below 10/12** — first check the refresh window,
  not the thresholds. Layer 1's crises span ~60 days but the default
  live-inject window is 6h. `--since-hours 1440` covers the full seed;
  the acceptance sweep uses this constant (`CRISIS_SPAN_HOURS`). Only
  lower thresholds in `detectors.py` if wide-window recall still misses.
- **§3 refresh > 60s** — expected budget is ~25–30s on ClickHouse Cloud
  Mini. If you're seeing several minutes, check the query with
  `EXPLAIN PIPELINE` — a common cause is an idle service being cold on
  first query. Re-run once warm before treating this as a real failure.
- **Zero detections after refresh** — the refresh anchors to
  `least(now(), max(ts) FROM roll_sentiment_hourly)`. If sentiment
  rollup is empty, no detections fire. Re-run backfill.
- **`QUALIFY` unsupported** — some older ClickHouse Cloud versions
  reject `QUALIFY`. Wrap the detector body in `SELECT * FROM (...) WHERE
  abs(magnitude) >= T` and move the predicate to the outer `WHERE`.
- **`crisis_ground_truth` empty at `--verify`** — Layer 1's crisis
  injector wasn't run. `python -m data.crisis_injector --seed-historical 12`.
- **Rollup rows = 0 after backfill** — source Layer 1 table is empty.
  Fix Layer 1 first (`python -m data.generate_numeric`).
- **New analyzer errors on `GROUP BY <expr>`** — ClickHouse 26.2's new
  analyzer resolves aliases in GROUP BY before expressions. If your
  SELECT aliases `toStartOfHour(ts) AS ts`, `GROUP BY toStartOfHour(ts)`
  fails — use `GROUP BY ts` (the alias) instead.
