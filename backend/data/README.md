# Layer 1 — Data Foundation

This directory is the sole owner of ClickHouse Cloud writes at build time.
It seeds a real TMDB film catalog, expands it into ~50–65M rows of numeric
telemetry across 15 regions × 120 days, generates ~150K review documents
with Gemini, and records ground-truth crisis events used by the Layer 6
evaluation harness.

## Boundary rule (rules-critical)

`ch_client.py` wraps `clickhouse-connect` for direct ClickHouse access. It is
imported **only** by modules in `backend/data/*` and (later)
`backend/data/mv/*`. Agents never import it — they reach ClickHouse through
the `mcp-clickhouse` MCP server, which is the path the ClickHouse-track
judges verify.

## Prerequisites

- Python 3.11+, virtualenv activated
- `.env` populated from `.env.example` — must include:
  - `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`,
    `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB`
  - `TMDB_API_KEY`
  - `GOOGLE_APPLICATION_CREDENTIALS` (path to Vertex service-account JSON),
    `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`
- ClickHouse Cloud service reachable (Mini tier is enough, 12GB)
- Neither `.env` nor `service-account.json` is committed — verified by
  `.gitignore` and the secret-scan below

## One-shot build sequence

Run from `backend/`, with the virtualenv active. Each step is idempotent
and safe to re-run.

```bash
# 1. Apply schema (creates 13 tables; add --reset --yes to drop first)
./venv/bin/python -m data.apply_schema

# 2. Seed the film catalog from TMDB (~250 films, cached to seed/*.parquet)
./venv/bin/python -m data.seed_tmdb

# 3. Generate numeric telemetry (~51M rows across 10 tables, 15–30 min)
./venv/bin/python -m data.generate_numeric

# 4. Seed historical crisis events (12 recorded in crisis_ground_truth)
./venv/bin/python -m data.crisis_injector --seed-historical 12

# 5. Generate review text with Gemini (~150K rows, cost-capped at $25)
./venv/bin/python -m data.generate_text
```

Steps 3 and 5 are the long-running ones. Step 5 requires Vertex AI auth
to be configured; use `GEMINI_DRYRUN=1 ./venv/bin/python -m data.generate_text`
to smoke the code path without spending tokens.

## Verification

Every module ships a `--verify` (or module-level `verify()`) that prints
row counts and sanity numbers. Run them after the full build:

```bash
./venv/bin/python -m data.apply_schema --verify
./venv/bin/python -m data.seed_tmdb --verify
./venv/bin/python -m data.generate_numeric --verify
./venv/bin/python -m data.crisis_injector --verify
./venv/bin/python -m data.generate_text --verify
```

Expected shape after a complete build:

- `films`: 250 rows, avg popularity > 20, most rows with real signals
- `box_office_revenue`: ~450K rows (250 × 15 × 120)
- `streaming_watch_minutes`, `audience_sentiment`, `social_trends`,
  `trailer_analytics`: hourly-spliced, ~10M+ rows each
- `marketing_spend`, `campaign_performance`, `ticket_refunds`,
  `review_scores`, `competitor_releases`: daily grain, ~450K each
- `reviews_text`: ~150K rows (after full Gemini run)
- `crisis_ground_truth`: 12+ rows (historical seed)

## Resetting

To rebuild from scratch (drops all tables, refetches TMDB, regenerates
everything):

```bash
./venv/bin/python -m data.apply_schema --reset --yes
./venv/bin/python -m data.seed_tmdb --refresh
./venv/bin/python -m data.generate_numeric
./venv/bin/python -m data.crisis_injector --seed-historical 12
./venv/bin/python -m data.generate_text
```

`--refresh` on `seed_tmdb` ignores the parquet cache and re-hits TMDB.

## Compliance notes

- **Runtime AI is Google-only.** `generate_text` uses `google-genai` /
  Vertex AI Gemini 2.5 Flash. No OpenAI, Anthropic, or other model
  providers are imported anywhere in shipped code.
- **Agent path uses mcp-clickhouse.** Direct `clickhouse-connect` access
  via `ch_client.py` is confined to `backend/data/` — enforced by the
  module docstring and code review.
- **Secrets are never committed.** `.env`, `service-account.json`, and
  `backend/data/seed/gen_state.json` are all gitignored. Credentials
  live only in `.env` and are never echoed by any module.

## Troubleshooting

- **`Missing required env var`** — copy `.env.example` to `.env` and
  fill in the ClickHouse and TMDB values.
- **`400 Cannot parse date` from ClickHouse** — TMDB returned a film
  with a pre-1970 release date; `_pick_films` filters these out. If
  you see this, refresh the parquet cache with `--refresh`.
- **`404` from TMDB per-film fetch** — the parquet cache has a stale
  `tmdb_id`. Delete `seed/tmdb_live.parquet` and re-run.
- **`generate_text` refuses to run** — check `seed/gen_state.json`;
  the cost cap is $25. Delete the file to reset.
- **Row counts lower than expected** — a batch failed silently. Check
  the tail of the generator's log; re-running is safe because every
  writer either truncates or upserts by version.
