# Layer 1 — Data Foundation Design

**Project:** Studio Crisis Commander (Agentic Cinema hackathon, ClickHouse track)
**Layer:** 1 of 6 (Data)
**Date:** 2026-08-07
**Status:** Approved — ready for implementation planning

---

## 1. Goal

Ground the entire product in a credible telemetry dataset: **250 real TMDB films × 15 regions × 120 days → ~50–65M numeric rows + 150K text rows**, with **8 crisis scenarios** injectable on demand and a **ground-truth table** that powers the eval harness (Layer 6). Every downstream layer (Detection, Agents, UI) reads from this dataset; nothing else works until this exists in ClickHouse.

## 2. Non-goals

- No materialized views (Layer 2).
- No `mcp-clickhouse` calls (Layer 3).
- No FastAPI / HTTP surface (Layer 4).
- No React (Layer 5).
- No `pytest` scaffolding yet — end-to-end + demo-flow smoke tests come in Layer 6 (per user preference A9).

## 3. Hard constraints inherited from `RULES_COMPLIANCE.md`

1. **Google-only AI at runtime.** Layer 1 uses Gemini via `google-genai` for synthetic review text — a legitimate build-time Google-AI use.
2. **`clickhouse-connect` is scoped strictly to Layer 1 (this layer) and Layer 2 (MV setup).** Agents in Layer 3 will use `mcp-clickhouse` only. Every Layer 1 script imports from `data/ch_client.py`, whose module docstring names this boundary explicitly.
3. **No non-Google AI libraries anywhere.** No `openai`, `anthropic`, `langchain`, `llama-index`, `crewai`, Llama, Mistral, Cohere.
4. **No secrets in code or `.env.example`.** `.env` and `service-account.json` remain gitignored. `TMDB_API_KEY` reaches code via `os.environ` only.
5. **New code only** — no copy-paste from RepoPulse / Course Copilot / HackForge / PlanAI / Zeno; patterns are fine.

## 4. Architecture

### 4.1 The four signal families

Every table joins on `(film_id, region, time_bucket)`. This is what makes cross-signal crises possible.

| Family | Tables | Role in a crisis |
|---|---|---|
| **Numeric** (WHAT) | `box_office_revenue`, `streaming_watch_minutes`, `trailer_analytics`, `marketing_spend`, `audience_sentiment`, `social_trends`, `ticket_refunds`, `review_scores`, `campaign_performance` | Detection Agent runs SQL over these |
| **Text** (WHY) | `reviews_text` (raw_text + computed sentiment_score) | Investigation Agent reads the actual language via MCP |
| **Categorical** (WHERE) | genre / region / variant / channel / competitor cols embedded in numeric tables | Isolates the crisis to a slice |
| **Temporal** (WHEN) | release_date on films, `competitor_releases`, timestamp on every row | Explains timing (holiday, competitor opening, etc.) |

Plus:
- **`films`** — the 250-film dimension table seeded from TMDB (title, budget, genre, release_date, runtime, language, tmdb_id).
- **`crisis_ground_truth`** — one row per injected crisis, the eval harness's answer key.

Total: **13 tables** — `films`, 10 numeric/temporal telemetry tables (`box_office_revenue`, `streaming_watch_minutes`, `trailer_analytics`, `marketing_spend`, `audience_sentiment`, `social_trends`, `ticket_refunds`, `review_scores`, `competitor_releases`, `campaign_performance`), `reviews_text`, `crisis_ground_truth`.

### 4.2 Component map

```
backend/data/
├── __init__.py
├── ch_client.py            # thin clickhouse-connect wrapper (Layer 1&2 only)
├── schema.sql              # DDL for all 12 tables
├── apply_schema.py         # idempotent apply, --reset drops+recreates
├── seed_tmdb.py            # Kaggle catalog + TMDB live API → parquet cache
├── region_split.py         # deterministic pop×genre regional split model
├── generate_numeric.py     # 10 telemetry tables (9 numeric + competitor_releases) → CH via batch inserts
├── ground_truth.py         # pydantic model + writer for crisis_ground_truth
├── crisis_injector.py      # historical + live crisis perturbations
├── generate_text.py        # Gemini structured-JSON review generator
├── README.md               # runbook for the whole pipeline
└── seed/                   # gitignored cache
    ├── tmdb_catalog.parquet
    ├── tmdb_live.parquet
    └── gen_state.json      # text generator resume checkpoint
```

Each module has one responsibility and can be invoked standalone (`python -m data.<module>`) for isolation and debugging.

### 4.3 Data flow (bottom-up)

```
[Kaggle TMDB dataset]   [TMDB REST API]
        \                    /
         \                  /
      seed_tmdb.py → seed/*.parquet (cached)
                    │
                    ▼
              films table (250 rows)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
 generate_numeric  crisis_injector (historical seeds)
   (9 numeric        │
    telemetry        │  writes to numeric tables +
    tables)          │  writes crisis_ground_truth
        │            │
        └─────┬──────┘
              ▼
     generate_text.py (Gemini)
              │  clusters 40% of reviews around crisis windows
              ▼
        reviews_text (150K rows)
              │
              ▼
     ClickHouse ready for Layer 2
```

### 4.4 Numeric generation model

For each film × region × time cell we compose:

- **Anchor curve** — pre-release build (14 days ramp), opening spike, exponential decay (τ ≈ 30 days). Scaled to TMDB `revenue` × regional share.
- **Regional split** (`region_split.py`) — deterministic function of `(genre, region)` using a documented weight table (e.g., anime skews Japan/Korea, superhero skews NA). Weights sum to 1.
- **Cadence** — daily for box office / spend / refunds / reviews / competitors; hourly for streaming / sentiment / social / trailer.
- **Noise** — Gaussian on log-scale (σ ≈ 0.08), seeded `random.Random(hash((film_id, region, table)))` so regeneration is reproducible.
- **Cross-signal coupling** — sentiment and social share a common latent "buzz" factor per (film, region, day) so they move together, making anomalies feel real.

Row counts (verified in Layer 1 acceptance):
- 4 hourly tables × (24 × 120 × 15 × 250) ≈ **43.2M rows**
- 6 daily tables × (120 × 15 × 250) ≈ **2.7M rows**
- Multi-channel fanout on `marketing_spend` and `campaign_performance` (≈4 channels each) → +**~5.4M rows**
- **Total ≈ 51M rows.** Room to grow to 65M by adding platforms/variants if needed.

### 4.5 Text generation model

- **Model:** `gemini-2.5-flash` via `google-genai` (fallback: `gemini-1.5-flash` if 2.5 not GA in `us-east1`).
- **Structured output schema:** `{ raw_text: str, sentiment_score: float in [-1, 1], themes: list[str] }`.
- **Batching:** 25 reviews per request → 6,000 requests for 150K rows.
- **Distribution:** 60% baseline reviews spread across all films/regions/dates; 40% clustered ±2 days around each seeded historical crisis window to give Investigation dense signal.
- **Resumability:** `seed/gen_state.json` records last completed batch. Rerun skips completed batches. Never regenerates existing rows.
- **Cost ceiling:** ~$5–15 on Flash. Log token usage per batch to `seed/gen_state.json`.
- **Storage:** each row = `(film_id, region, timestamp, source, raw_text, sentiment_score, themes)`. Two-layer pattern: numeric `sentiment_score` for fast SQL detection, `raw_text` for LLM narration via MCP.

### 4.6 Crisis injector — historical vs live

Layer 1 provides the **injection primitive**, callable in two modes:

- **Historical mode** (used during initial seeding): `crisis_injector.seed_historical(N=12)` writes 12 pre-baked crises spread across the 120-day window with fixed timestamps. Text generator then clusters reviews around these. This gives Detection anomalies to fire on and Investigation dense text to read from day one.
- **Live mode** (used by Layer 4's `/inject-crisis` endpoint): `crisis_injector.inject_now(type, film_id, region, magnitude)` writes perturbation rows with `timestamp = now()` and a matching ground-truth row.

Both paths write the same shape to `crisis_ground_truth`. The 8 crisis types from AI_BUILD_CONTEXT § 2 are enumerated as an `Enum`. Randomization uses `random.SystemRandom` for live mode.

### 4.7 Ground truth schema

```
crisis_ground_truth:
  crisis_id           UUID          PRIMARY
  injection_timestamp DateTime64(3)
  is_live             UInt8         (0 = historical seed, 1 = live-injected)
  type                LowCardinality(String)  -- one of 8 scenario names
  affected_film_id    UInt64
  affected_region     LowCardinality(String)
  magnitude           Float32       (relative perturbation, e.g. 0.28 = 28%)
  affected_tables     Array(String)
  true_root_cause     String        (short human-readable label)
  expected_recommendation String    (what the Decision Agent should recommend)
  resolution_window_hours UInt16
```

Engine: `ReplacingMergeTree` ordered by `crisis_id` so re-inserts are idempotent.

### 4.8 ClickHouse table conventions

All telemetry tables:
- Engine: `MergeTree`
- `PARTITION BY toYYYYMM(timestamp_or_date)`
- `ORDER BY (film_id, region, timestamp_or_date)`
- `SETTINGS index_granularity = 8192` (default)
- `LowCardinality(String)` for region, channel, platform, variant, source, genre (~15 distinct values each — big compression win)

## 5. Error handling & idempotency

- **Schema apply** — `CREATE TABLE IF NOT EXISTS` by default; `--reset` runs `DROP TABLE IF EXISTS` first and requires an explicit `--yes` flag (never blocks on interactive prompt in non-TTY runs).
- **TMDB fetch** — `tenacity` retry (5 attempts, exp backoff) on 429/5xx. Cache-first: if `seed/*.parquet` exists, skip network unless `--refresh`.
- **Numeric generation** — insert in batches of 500K rows with `settings={'async_insert': 0}` for deterministic errors. On failure, log the failing batch key and abort — do not partial-commit silently.
- **Text generation** — checkpoint after every batch. On Gemini API error, retry 3×, then skip batch and continue (logged in gen_state.json). Post-run verifier reports missing batches.
- **Crisis injector** — `ReplacingMergeTree` on ground truth; re-running the same seed is a no-op after `OPTIMIZE FINAL`.

## 6. Testing (deferred per A9)

No unit tests in Layer 1. Every script has a `--verify` mode that runs a self-check:
- `apply_schema --verify` → `SHOW TABLES` returns 12.
- `generate_numeric --verify` → `SELECT count() FROM box_office_revenue` in expected range.
- `generate_text --verify` → count in `reviews_text` == 150,000.

End-to-end smoke test + demo-flow test come in Layer 6.

## 7. Assumptions (approved in brainstorming session)

- A1 ✓ Duplicate root `.venv/` removed; `backend/venv` is canonical.
- A2 ✓ `.env` populated by user; never read by Claude.
- A3 ✓ `service-account.json` valid for Vertex/Gemini.
- A4 ✓ CH Mini (12 GB) sized for ~50–65M rows post-compression.
- A5 ✓ User supplied TMDB API key privately; added blank line to `.env.example`.
- A6 ✓ Kaggle dataset via direct URL, no `kaggle` CLI dependency.
- A7 ✓ `google-genai` for Gemini text calls; `google-cloud-aiplatform[adk]` for ADK (Layer 3).
- A8 ✓ 10–15 historical crises seeded during Layer 1.
- A9 ✓ Tests deferred to Layer 6.
- A10 ✓ Frontend untouched until Layer 5.
- A11 ✓ Layer 1 does not touch `mcp-clickhouse` or MVs.

## 8. Deliverables & acceptance criteria

Layer 1 is done when:

1. `python -m data.apply_schema` creates 13 tables in ClickHouse.
2. `python -m data.seed_tmdb` populates `seed/tmdb_catalog.parquet` (250 films) and `seed/tmdb_live.parquet`, and inserts `films`.
3. `python -m data.generate_numeric` produces **≥ 50M rows** across the 10 telemetry tables (verified via `SELECT sum() ...`).
4. `python -m data.crisis_injector --seed-historical 12` writes 12 crises + ground-truth rows.
5. `python -m data.generate_text` writes exactly **150,000** rows to `reviews_text`, resumable.
6. All scripts pass their `--verify` mode.
7. `backend/data/README.md` contains a one-page runbook that a fresh clone can follow.
8. `requirements.txt` includes `clickhouse-connect`, `requests`, `pyarrow`, `pandas`, `tenacity`.
9. `.env.example` has `TMDB_API_KEY=` placeholder (no value).
10. No secrets in git; a grep for the first 8 chars of any live credential in `.env` returns nothing outside `.env` itself.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TMDB rate limits during initial fetch | `tenacity` retry + local parquet cache; one-time cost |
| Gemini bill spike on 150K rows | Flash-only, batched, checkpointed; hard cap in code — abort if projected cost >$25 |
| Row count falls short of 50M | Hourly cadence + multi-channel fanout gives headroom; can pull streaming to sub-hourly if needed |
| `mcp-clickhouse` accidentally imported in Layer 1 code | `ch_client.py` docstring names the boundary; Layer 3 spec will re-verify |
| Regional split feels obviously synthetic | Documented weight model + noise; anchored to real TMDB revenue totals |

## 10. Commit sequence (one commit per step)

1. `data: add ch_client boundary wrapper` — `ch_client.py` + smoke test.
2. `data: schema + apply script (12 tables)` — `schema.sql`, `apply_schema.py`.
3. `data: update requirements and env template for layer 1` — `requirements.txt`, `.env.example`.
4. `data: seed TMDB catalog + live signals` — `seed_tmdb.py`.
5. `data: regional split model` — `region_split.py`.
6. `data: numeric telemetry generator (~50M rows)` — `generate_numeric.py`.
7. `data: crisis ground truth schema and writer` — `ground_truth.py`.
8. `data: crisis injector (historical + live modes)` — `crisis_injector.py`.
9. `data: gemini review text generator (150K rows)` — `generate_text.py`.
10. `data: runbook for layer 1 pipeline` — `backend/data/README.md`.

Each commit is independently reviewable; each leaves the tree in a valid state.
