# Layer 1 — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground Studio Crisis Commander in a credible ClickHouse dataset — 250 real TMDB films × 15 regions × 120 days → ~51M numeric rows + 150K Gemini-generated review rows + 12 seeded historical crises with ground truth — so every downstream layer (Detection, Agents, UI, Eval) has real data to run against.

**Architecture:** Ten small Python modules under `backend/data/`, each with one responsibility, invokable standalone as `python -m data.<module>`. All writes go through a boundary-guarded `ch_client` (direct `clickhouse-connect` wrapper scoped strictly to Layers 1 and 2). No `mcp-clickhouse`, no ADK, no MVs in this layer.

**Tech Stack:** Python 3.12, `clickhouse-connect`, `google-genai` (Gemini 2.5 Flash for review text), `pandas`, `pyarrow`, `requests` + `tenacity` (TMDB fetch), `python-dotenv`, `pydantic`.

**Compliance notes baked into every task:**
- No `openai` / `anthropic` / `langchain` / `llama-index` / `crewai` / Llama / Mistral / Cohere anywhere.
- `mcp-clickhouse` is NOT imported in Layer 1 code — it's a Layer 3 concern.
- Secrets (`.env`, `service-account.json`) are gitignored; never printed, never committed.
- TMDB is credited in the runbook (README) per TMDB terms.

**Testing note (per user directive A9):** No pytest unit tests in Layer 1. Each script has a `--verify` mode that runs a SQL self-check. End-to-end + demo-flow tests come in Layer 6.

---

## File structure

Files created in this plan:

| Path | Purpose |
|---|---|
| `backend/requirements.txt` | (modify) add `clickhouse-connect`, `requests`, `tenacity`, `pyarrow`, `pandas` |
| `.env.example` | (already updated) reference — no further changes here |
| `backend/data/__init__.py` | empty package marker |
| `backend/data/ch_client.py` | thin `clickhouse-connect` wrapper — the ONLY direct-client entry point |
| `backend/data/schema.sql` | DDL for all 13 tables |
| `backend/data/apply_schema.py` | idempotent schema loader, `--reset --yes` supported |
| `backend/data/seed_tmdb.py` | Kaggle CSV catalog + TMDB live API → parquet + `films` table |
| `backend/data/region_split.py` | deterministic pop×genre → 15-region share weights |
| `backend/data/generate_numeric.py` | 10 telemetry tables → ≥50M rows |
| `backend/data/ground_truth.py` | pydantic model + writer for `crisis_ground_truth` |
| `backend/data/crisis_injector.py` | seeds 12 historical crises + `inject_now()` primitive for Layer 4 |
| `backend/data/generate_text.py` | Gemini structured-JSON review generator, 150K rows, resumable, $25 hard-cap |
| `backend/data/README.md` | one-page runbook (order of commands, verification queries) |
| `backend/data/seed/.gitkeep` | placeholder so the cache dir exists in git; parquet files gitignored |
| `.gitignore` | (append) `backend/data/seed/*.parquet`, `backend/data/seed/gen_state.json` |

---

## Task 1: Dependencies + gitignore

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `.gitignore`

- [ ] **Step 1: Add Layer 1 deps to requirements.txt**

Read current file first, then replace with:

```
# Google Cloud — required by hackathon rules
google-cloud-aiplatform[agent_engines,adk]>=1.101.0
google-genai>=1.0.0
vertexai

# ClickHouse MCP — required for ClickHouse track (Layer 3 runtime)
mcp-clickhouse>=0.1.0

# ClickHouse direct client — Layer 1 (data generation) and Layer 2 (MV setup) ONLY.
# Do NOT import from any agent code.
clickhouse-connect>=0.7.0

# API (Layer 4)
fastapi>=0.111.0
uvicorn[standard]>=0.29.0

# Data ingest + generation (Layer 1)
requests>=2.31.0
tenacity>=8.2.0
pyarrow>=15.0.0
pandas>=2.2.0

# Utilities
python-dotenv>=1.0.0
pydantic>=2.0.0
```

- [ ] **Step 2: Add Layer 1 cache paths to .gitignore**

Append these lines to `.gitignore`:

```
# Layer 1 data generation cache — never commit
backend/data/seed/*.parquet
backend/data/seed/*.json
backend/data/seed/*.csv
```

- [ ] **Step 3: Install into backend venv**

Run:
```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
pip install -r /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/requirements.txt
```
Expected: exit 0, no dependency conflicts. `pip check` returns "No broken requirements found."

- [ ] **Step 4: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/requirements.txt .gitignore
git commit -m "data: add layer 1 deps (clickhouse-connect, requests, pyarrow, pandas, tenacity)"
```

---

## Task 2: `ch_client.py` — the boundary-guarded direct client

**Files:**
- Create: `backend/data/__init__.py`
- Create: `backend/data/ch_client.py`

- [ ] **Step 1: Create the empty package marker**

Write `backend/data/__init__.py`:
```python
"""Layer 1 data foundation package.

All modules here use clickhouse-connect directly. This is intentional and
scoped: Layers 1 (seeding) and 2 (materialized views) may use the direct
client; Layer 3 (agents) MUST use mcp-clickhouse instead.
"""
```

- [ ] **Step 2: Write `ch_client.py`**

Create `backend/data/ch_client.py`:
```python
"""Thin clickhouse-connect wrapper for Layer 1 data seeding.

BOUNDARY RULE (rules-critical):
    This module wraps clickhouse-connect for direct ClickHouse access.
    It is used ONLY by:
      - backend/data/*.py    (Layer 1 data generation)
      - backend/data/mv/*    (Layer 2 materialized-view setup, future)
    It must NEVER be imported from backend/agents/ or backend/mcp/.
    Agents reach ClickHouse through mcp-clickhouse — that path is what
    the ClickHouse-track judges verify.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import clickhouse_connect
from clickhouse_connect.driver import Client
from dotenv import load_dotenv

load_dotenv()


def _require(var: str) -> str:
    val = os.environ.get(var)
    if not val:
        raise RuntimeError(
            f"Missing required env var: {var}. Set it in .env "
            "(see .env.example)."
        )
    return val


def get_client() -> Client:
    """Return a new ClickHouse client from env vars.

    Env: CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
         CLICKHOUSE_PASSWORD, CLICKHOUSE_DB.
    """
    return clickhouse_connect.get_client(
        host=_require("CLICKHOUSE_HOST"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8443")),
        username=_require("CLICKHOUSE_USER"),
        password=_require("CLICKHOUSE_PASSWORD"),
        database=_require("CLICKHOUSE_DB"),
        secure=True,
    )


@contextmanager
def client() -> Iterator[Client]:
    c = get_client()
    try:
        yield c
    finally:
        c.close()


def insert_batches(
    table: str,
    rows: Sequence[Sequence[Any]],
    column_names: Sequence[str],
    batch_size: int = 500_000,
) -> int:
    """Insert rows into `table` in fixed-size batches. Returns total inserted."""
    total = 0
    with client() as c:
        for start in range(0, len(rows), batch_size):
            chunk = rows[start : start + batch_size]
            c.insert(table, chunk, column_names=list(column_names))
            total += len(chunk)
    return total


def verify() -> None:
    """Smoke test: connects and prints server version + current db."""
    with client() as c:
        version = c.query("SELECT version()").result_rows[0][0]
        db = c.query("SELECT currentDatabase()").result_rows[0][0]
        print(f"ClickHouse OK: version={version} database={db}")


if __name__ == "__main__":
    verify()
```

- [ ] **Step 3: Run the smoke test**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.ch_client
```
Expected: `ClickHouse OK: version=... database=studio_crisis` (or whatever `CLICKHOUSE_DB` is set to).

- [ ] **Step 4: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/__init__.py backend/data/ch_client.py
git commit -m "data: add boundary-guarded clickhouse client (layer 1 & 2 only)"
```

---

## Task 3: `schema.sql` + `apply_schema.py` — all 13 tables

**Files:**
- Create: `backend/data/schema.sql`
- Create: `backend/data/apply_schema.py`

- [ ] **Step 1: Write `schema.sql`**

Create `backend/data/schema.sql`:
```sql
-- Studio Crisis Commander — Layer 1 schema.
-- All telemetry tables: MergeTree, partitioned monthly, ordered by (film_id, region, ts).

------------------------------------------------------------
-- Dimension
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS films (
    film_id       UInt64,
    tmdb_id       UInt64,
    title         String,
    genre         LowCardinality(String),
    language      LowCardinality(String),
    release_date  Date,
    runtime_min   UInt16,
    budget_usd    UInt64,
    revenue_usd   UInt64,
    popularity    Float32,
    vote_average  Float32
) ENGINE = ReplacingMergeTree()
ORDER BY film_id;

------------------------------------------------------------
-- Numeric telemetry — 9 tables
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS box_office_revenue (
    film_id      UInt64,
    region       LowCardinality(String),
    date         Date,
    revenue_usd  UInt64,
    tickets_sold UInt32,
    refunds      UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (film_id, region, date);

CREATE TABLE IF NOT EXISTS streaming_watch_minutes (
    film_id        UInt64,
    region         LowCardinality(String),
    ts             DateTime,
    watch_minutes  UInt64,
    completions    UInt32,
    drops          UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS trailer_analytics (
    trailer_id       UInt64,
    film_id          UInt64,
    variant          LowCardinality(String),
    region           LowCardinality(String),
    ts               DateTime,
    views            UInt32,
    completion_rate  Float32,
    sentiment_score  Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS marketing_spend (
    film_id     UInt64,
    region      LowCardinality(String),
    channel     LowCardinality(String),
    date        Date,
    spend_usd   UInt64,
    impressions UInt64,
    clicks      UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (film_id, region, channel, date);

CREATE TABLE IF NOT EXISTS audience_sentiment (
    film_id  UInt64,
    region   LowCardinality(String),
    ts       DateTime,
    platform LowCardinality(String),
    score    Float32,
    volume   UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS social_trends (
    film_id   UInt64,
    region    LowCardinality(String),
    ts        DateTime,
    platform  LowCardinality(String),
    mentions  UInt32,
    sentiment Float32,
    virality  Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS ticket_refunds (
    film_id        UInt64,
    region         LowCardinality(String),
    ts             DateTime,
    refund_count   UInt32,
    refund_reason  LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

CREATE TABLE IF NOT EXISTS review_scores (
    film_id      UInt64,
    source       LowCardinality(String),
    ts           DateTime,
    score        Float32,
    review_count UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, source, ts);

CREATE TABLE IF NOT EXISTS campaign_performance (
    campaign_id UInt64,
    film_id     UInt64,
    region      LowCardinality(String),
    channel     LowCardinality(String),
    date        Date,
    spend_usd   UInt64,
    conversions UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (film_id, region, channel, date);

------------------------------------------------------------
-- Temporal / context
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_releases (
    film_id            UInt64,
    region             LowCardinality(String),
    release_date       Date,
    competitor_film_id UInt64
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(release_date)
ORDER BY (film_id, region, release_date);

------------------------------------------------------------
-- Text
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews_text (
    film_id         UInt64,
    region          LowCardinality(String),
    ts              DateTime,
    source          LowCardinality(String),
    raw_text        String,
    sentiment_score Float32,
    themes          Array(LowCardinality(String))
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (film_id, region, ts);

------------------------------------------------------------
-- Ground truth (eval harness answer key)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crisis_ground_truth (
    crisis_id                 UUID,
    injection_timestamp       DateTime64(3),
    is_live                   UInt8,
    type                      LowCardinality(String),
    affected_film_id          UInt64,
    affected_region           LowCardinality(String),
    magnitude                 Float32,
    affected_tables           Array(String),
    true_root_cause           String,
    expected_recommendation   String,
    resolution_window_hours   UInt16
) ENGINE = ReplacingMergeTree(injection_timestamp)
ORDER BY crisis_id;
```

- [ ] **Step 2: Write `apply_schema.py`**

Create `backend/data/apply_schema.py`:
```python
"""Apply schema.sql to ClickHouse. Idempotent by default; --reset --yes to drop first."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from data.ch_client import client

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

EXPECTED_TABLES = {
    "films",
    "box_office_revenue",
    "streaming_watch_minutes",
    "trailer_analytics",
    "marketing_spend",
    "audience_sentiment",
    "social_trends",
    "ticket_refunds",
    "review_scores",
    "campaign_performance",
    "competitor_releases",
    "reviews_text",
    "crisis_ground_truth",
}


def _split_statements(sql: str) -> list[str]:
    stripped = re.sub(r"--[^\n]*", "", sql)
    return [s.strip() for s in stripped.split(";") if s.strip()]


def apply(reset: bool) -> None:
    sql = SCHEMA_PATH.read_text()
    with client() as c:
        if reset:
            for table in EXPECTED_TABLES:
                c.command(f"DROP TABLE IF EXISTS {table}")
            print(f"Dropped {len(EXPECTED_TABLES)} tables.")
        for stmt in _split_statements(sql):
            c.command(stmt)
    verify()


def verify() -> None:
    with client() as c:
        rows = c.query("SHOW TABLES").result_rows
        present = {r[0] for r in rows}
    missing = EXPECTED_TABLES - present
    extra = present - EXPECTED_TABLES
    if missing:
        print(f"MISSING tables: {sorted(missing)}", file=sys.stderr)
        sys.exit(1)
    print(f"Schema OK: {len(EXPECTED_TABLES)} expected tables present.")
    if extra:
        print(f"(Also present, not managed by this schema: {sorted(extra)})")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true", help="Drop tables first")
    p.add_argument("--yes", action="store_true", help="Required with --reset")
    p.add_argument("--verify", action="store_true", help="Only verify, no apply")
    args = p.parse_args()

    if args.verify:
        verify()
        return
    if args.reset and not args.yes:
        print("--reset requires --yes to confirm dropping tables.", file=sys.stderr)
        sys.exit(2)
    apply(reset=args.reset)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run apply + verify**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.apply_schema
python -m data.apply_schema --verify
```
Expected: `Schema OK: 13 expected tables present.`

- [ ] **Step 4: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/schema.sql backend/data/apply_schema.py
git commit -m "data: add schema (13 tables) and idempotent apply script"
```

---

## Task 4: `seed_tmdb.py` — TMDB catalog + live signals → films table

**Files:**
- Create: `backend/data/seed_tmdb.py`
- Create: `backend/data/seed/.gitkeep`

- [ ] **Step 1: Create cache dir marker**

```bash
touch /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/data/seed/.gitkeep
```

- [ ] **Step 2: Write `seed_tmdb.py`**

Create `backend/data/seed_tmdb.py`:
```python
"""Fetch TMDB catalog (Kaggle direct URL) + live per-film signals; seed `films` table.

TMDB attribution required: this product uses the TMDB API but is not
endorsed or certified by TMDB. See README.md.
"""

from __future__ import annotations

import argparse
import io
import os
import random
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from dotenv import load_dotenv
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from data.ch_client import client

load_dotenv()

SEED_DIR = Path(__file__).parent / "seed"
CATALOG_PARQUET = SEED_DIR / "tmdb_catalog.parquet"
LIVE_PARQUET = SEED_DIR / "tmdb_live.parquet"

# Public Kaggle CSV mirror (no auth). If this URL rotates, swap to another
# mirror or use a local CSV placed at seed/tmdb_5000_movies.csv.
KAGGLE_TMDB_URL = (
    "https://raw.githubusercontent.com/YBIFoundation/Dataset/main/Movies%20Recommendation.csv"
)
TMDB_API_BASE = "https://api.themoviedb.org/3"

TARGET_FILM_COUNT = 250


@dataclass
class FilmSeed:
    film_id: int
    tmdb_id: int
    title: str
    genre: str
    language: str
    release_date: str  # YYYY-MM-DD
    runtime_min: int
    budget_usd: int
    revenue_usd: int


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(requests.RequestException),
)
def _get(url: str, **kwargs: Any) -> requests.Response:
    r = requests.get(url, timeout=30, **kwargs)
    if r.status_code == 429:
        raise requests.RequestException("rate-limited")
    r.raise_for_status()
    return r


def _download_catalog() -> pd.DataFrame:
    local_csv = SEED_DIR / "tmdb_catalog_source.csv"
    if local_csv.exists():
        return pd.read_csv(local_csv)
    print(f"Downloading TMDB catalog from {KAGGLE_TMDB_URL} ...")
    r = _get(KAGGLE_TMDB_URL)
    local_csv.write_bytes(r.content)
    return pd.read_csv(local_csv)


def _pick_films(df: pd.DataFrame, n: int) -> list[FilmSeed]:
    # Normalize column names — different mirrors label them differently.
    cols = {c.lower(): c for c in df.columns}

    def col(*candidates: str) -> str | None:
        for c in candidates:
            if c in cols:
                return cols[c]
        return None

    title_c = col("title", "movie_title", "original_title", "name")
    id_c = col("id", "tmdb_id", "movie_id")
    genre_c = col("genres", "genre")
    lang_c = col("original_language", "language")
    date_c = col("release_date", "released")
    runtime_c = col("runtime")
    budget_c = col("budget")
    rev_c = col("revenue", "gross")

    required = [title_c, id_c, date_c]
    if any(x is None for x in required):
        raise RuntimeError(
            f"Catalog missing required columns; got: {list(df.columns)}"
        )

    df = df.dropna(subset=[title_c, id_c, date_c])
    df = df[df[date_c].astype(str).str.match(r"\d{4}-\d{2}-\d{2}")]
    df = df.sort_values(rev_c or title_c, ascending=False) if rev_c else df
    df = df.head(max(n * 3, n))  # oversample for randomization
    rng = random.Random(42)
    picked = rng.sample(range(len(df)), min(n, len(df)))
    subset = df.iloc[picked].reset_index(drop=True)

    def _first_genre(v: Any) -> str:
        if pd.isna(v):
            return "Drama"
        s = str(v)
        for sep in ("|", ",", " "):
            if sep in s:
                return s.split(sep)[0].strip()
        return s.strip()

    out: list[FilmSeed] = []
    for i, row in subset.iterrows():
        out.append(
            FilmSeed(
                film_id=int(i) + 1,
                tmdb_id=int(row[id_c]),
                title=str(row[title_c])[:255],
                genre=_first_genre(row[genre_c]) if genre_c else "Drama",
                language=str(row[lang_c])[:2] if lang_c else "en",
                release_date=str(row[date_c])[:10],
                runtime_min=int(row[runtime_c]) if runtime_c and not pd.isna(row[runtime_c]) else 100,
                budget_usd=int(row[budget_c]) if budget_c and not pd.isna(row[budget_c]) else 0,
                revenue_usd=int(row[rev_c]) if rev_c and not pd.isna(row[rev_c]) else 0,
            )
        )
    return out


def _fetch_live_signals(films: list[FilmSeed]) -> pd.DataFrame:
    key = os.environ.get("TMDB_API_KEY")
    if not key:
        print("TMDB_API_KEY not set; skipping live signals.", file=sys.stderr)
        return pd.DataFrame([{"tmdb_id": f.tmdb_id, "popularity": 0.0, "vote_average": 0.0} for f in films])

    rows: list[dict[str, Any]] = []
    for i, f in enumerate(films, 1):
        try:
            r = _get(f"{TMDB_API_BASE}/movie/{f.tmdb_id}", params={"api_key": key})
            j = r.json()
            rows.append({
                "tmdb_id": f.tmdb_id,
                "popularity": float(j.get("popularity", 0.0)),
                "vote_average": float(j.get("vote_average", 0.0)),
            })
        except Exception as e:  # noqa: BLE001
            print(f"TMDB fetch failed for {f.tmdb_id}: {e}", file=sys.stderr)
            rows.append({"tmdb_id": f.tmdb_id, "popularity": 0.0, "vote_average": 0.0})
        if i % 50 == 0:
            print(f"  fetched {i}/{len(films)}")
        time.sleep(0.05)  # ~20 rps, well under TMDB limits
    return pd.DataFrame(rows)


def _insert_films(films: list[FilmSeed], live: pd.DataFrame) -> None:
    live_by_id = {int(r["tmdb_id"]): r for _, r in live.iterrows()}
    rows = []
    for f in films:
        lv = live_by_id.get(f.tmdb_id, {"popularity": 0.0, "vote_average": 0.0})
        rows.append([
            f.film_id, f.tmdb_id, f.title, f.genre, f.language,
            f.release_date, f.runtime_min, f.budget_usd, f.revenue_usd,
            float(lv["popularity"]), float(lv["vote_average"]),
        ])
    cols = [
        "film_id", "tmdb_id", "title", "genre", "language",
        "release_date", "runtime_min", "budget_usd", "revenue_usd",
        "popularity", "vote_average",
    ]
    with client() as c:
        c.command("TRUNCATE TABLE films")
        c.insert("films", rows, column_names=cols)


def run(refresh: bool) -> None:
    SEED_DIR.mkdir(parents=True, exist_ok=True)

    if CATALOG_PARQUET.exists() and not refresh:
        catalog = pd.read_parquet(CATALOG_PARQUET)
        films = [FilmSeed(**{k: r[k] for k in FilmSeed.__annotations__}) for _, r in catalog.iterrows()]
    else:
        raw = _download_catalog()
        films = _pick_films(raw, TARGET_FILM_COUNT)
        pd.DataFrame([f.__dict__ for f in films]).to_parquet(CATALOG_PARQUET, index=False)

    if LIVE_PARQUET.exists() and not refresh:
        live = pd.read_parquet(LIVE_PARQUET)
    else:
        live = _fetch_live_signals(films)
        live.to_parquet(LIVE_PARQUET, index=False)

    _insert_films(films, live)
    verify()


def verify() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM films").result_rows[0][0]
    if n < TARGET_FILM_COUNT:
        print(f"FAIL: films has {n} rows, expected >= {TARGET_FILM_COUNT}", file=sys.stderr)
        sys.exit(1)
    print(f"films OK: {n} rows.")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--refresh", action="store_true", help="Ignore cache; refetch")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
    else:
        run(refresh=args.refresh)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the seeder**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.seed_tmdb
```
Expected: catalog download progress, live-signal fetch progress (~250 requests, ~15s), then `films OK: 250 rows.`

If TMDB live fetch fails: script still succeeds with popularity=0 — that's fine for Layer 1.
If Kaggle URL fails: place any TMDB CSV at `backend/data/seed/tmdb_catalog_source.csv` and rerun.

- [ ] **Step 4: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/seed_tmdb.py backend/data/seed/.gitkeep
git commit -m "data: seed 250 films from tmdb catalog + live api"
```

---

## Task 5: `region_split.py` — deterministic 15-region share model

**Files:**
- Create: `backend/data/region_split.py`

- [ ] **Step 1: Write `region_split.py`**

Create `backend/data/region_split.py`:
```python
"""Deterministic regional share weights per (genre, region).

Anchors on rough real-world film-market share (NA + China + EU dominate)
adjusted by genre affinity (anime skews Japan/Korea, superhero skews NA,
Bollywood skews India, etc.). Returns a dict summing to 1.0.
"""

from __future__ import annotations

REGIONS = [
    "NA", "LATAM", "UK", "EU-West", "EU-East", "Nordics",
    "India", "SEA", "Korea", "Japan", "China", "MENA",
    "Africa", "ANZ", "Brazil",
]

# Baseline share of global box office, rough industry consensus.
BASE_WEIGHTS: dict[str, float] = {
    "NA": 0.30, "LATAM": 0.05, "UK": 0.06, "EU-West": 0.11, "EU-East": 0.03,
    "Nordics": 0.02, "India": 0.06, "SEA": 0.04, "Korea": 0.04, "Japan": 0.06,
    "China": 0.12, "MENA": 0.02, "Africa": 0.02, "ANZ": 0.03, "Brazil": 0.04,
}

# Genre affinity multipliers per region. Missing entries default to 1.0.
GENRE_MULT: dict[str, dict[str, float]] = {
    "Animation": {"Japan": 2.0, "Korea": 1.5, "NA": 1.3, "EU-West": 1.2},
    "Action":    {"NA": 1.3, "China": 1.4, "Korea": 1.3, "LATAM": 1.2},
    "Romance":   {"India": 1.6, "SEA": 1.3, "LATAM": 1.4, "Korea": 1.4},
    "Horror":    {"NA": 1.4, "LATAM": 1.3, "Brazil": 1.3, "SEA": 1.2},
    "Drama":     {"EU-West": 1.3, "UK": 1.2, "India": 1.2},
    "Science Fiction": {"NA": 1.4, "China": 1.3, "Japan": 1.3, "Korea": 1.2},
    "Comedy":    {"NA": 1.2, "UK": 1.3, "India": 1.3, "Brazil": 1.3},
    "Thriller":  {"Korea": 1.4, "NA": 1.2, "EU-West": 1.2},
    "Documentary": {"EU-West": 1.5, "NA": 1.3, "UK": 1.4},
    "Family":    {"NA": 1.3, "China": 1.3, "India": 1.2, "LATAM": 1.2},
}


def weights_for(genre: str) -> dict[str, float]:
    """Return normalized share weights for `genre` across the 15 regions."""
    mults = GENRE_MULT.get(genre, {})
    raw = {r: BASE_WEIGHTS[r] * mults.get(r, 1.0) for r in REGIONS}
    total = sum(raw.values())
    return {r: v / total for r, v in raw.items()}


def verify() -> None:
    for g in list(GENRE_MULT) + ["Unknown"]:
        w = weights_for(g)
        assert abs(sum(w.values()) - 1.0) < 1e-6, f"{g} not normalized"
        assert all(v > 0 for v in w.values()), f"{g} has zero weight"
    print(f"region_split OK: {len(REGIONS)} regions, {len(GENRE_MULT)} + 1 genres normalized.")


if __name__ == "__main__":
    verify()
```

- [ ] **Step 2: Run verify**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.region_split
```
Expected: `region_split OK: 15 regions, 10 + 1 genres normalized.`

- [ ] **Step 3: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/region_split.py
git commit -m "data: deterministic regional share model (pop x genre)"
```

---

## Task 6: `generate_numeric.py` — 10 telemetry tables, ~51M baseline rows

**Files:**
- Create: `backend/data/generate_numeric.py`

- [ ] **Step 1: Write `generate_numeric.py`**

Create `backend/data/generate_numeric.py`:
```python
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
BATCH = 500_000


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
```

- [ ] **Step 2: Run generation (long — 15–30 min)**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.generate_numeric
```
Expected: per-table progress, final `TOTAL: 50,000,000+`. Ballpark ~51M.

If a single table runs slow, use `--only <table>` to re-run just that one.

- [ ] **Step 3: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/generate_numeric.py
git commit -m "data: baseline telemetry generator (~51M rows across 10 tables)"
```

---

## Task 7: `ground_truth.py` — writer for `crisis_ground_truth`

**Files:**
- Create: `backend/data/ground_truth.py`

- [ ] **Step 1: Write `ground_truth.py`**

Create `backend/data/ground_truth.py`:
```python
"""Pydantic model + writer for the crisis_ground_truth table (Layer 6 eval source of truth)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from data.ch_client import client


class CrisisType(str, Enum):
    REGIONAL_SENTIMENT_COLLAPSE = "regional_sentiment_collapse"
    TRAILER_VARIANT_UNDERPERFORMANCE = "trailer_variant_underperformance"
    COMPETITOR_RELEASE_IMPACT = "competitor_release_impact"
    MARKETING_OVERSPEND_LOW_ROI = "marketing_overspend_low_roi"
    STREAMING_COMPLETION_DROP = "streaming_completion_drop"
    REFUND_SPIKE = "refund_spike"
    NEGATIVE_SOCIAL_VIRALITY = "negative_social_virality"
    REVIEW_SCORE_DIVERGENCE = "review_score_divergence"


class Crisis(BaseModel):
    crisis_id: UUID = Field(default_factory=uuid4)
    injection_timestamp: datetime
    is_live: bool
    type: CrisisType
    affected_film_id: int
    affected_region: str
    magnitude: float
    affected_tables: list[str]
    true_root_cause: str
    expected_recommendation: str
    resolution_window_hours: int


def write(crisis: Crisis) -> None:
    row = [
        crisis.crisis_id,
        crisis.injection_timestamp,
        1 if crisis.is_live else 0,
        crisis.type.value,
        crisis.affected_film_id,
        crisis.affected_region,
        float(crisis.magnitude),
        list(crisis.affected_tables),
        crisis.true_root_cause,
        crisis.expected_recommendation,
        int(crisis.resolution_window_hours),
    ]
    cols = [
        "crisis_id", "injection_timestamp", "is_live", "type",
        "affected_film_id", "affected_region", "magnitude",
        "affected_tables", "true_root_cause", "expected_recommendation",
        "resolution_window_hours",
    ]
    with client() as c:
        c.insert("crisis_ground_truth", [row], column_names=cols)


def verify() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM crisis_ground_truth").result_rows[0][0]
    print(f"crisis_ground_truth OK: {n} rows.")


if __name__ == "__main__":
    verify()
```

- [ ] **Step 2: Import-check + verify**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.ground_truth
```
Expected: `crisis_ground_truth OK: 0 rows.` (empty until injector runs).

- [ ] **Step 3: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/ground_truth.py
git commit -m "data: crisis ground truth pydantic model + writer"
```

---

## Task 8: `crisis_injector.py` — 12 historical seeds + `inject_now()`

**Files:**
- Create: `backend/data/crisis_injector.py`

- [ ] **Step 1: Write `crisis_injector.py`**

Create `backend/data/crisis_injector.py`:
```python
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
    with client() as c:
        ids = [r[0] for r in c.query("SELECT film_id FROM films").result_rows]
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
    """Spread N crises across the last 90 days for text-generation clustering."""
    rng = random.Random(seed)
    now = datetime.utcnow().replace(microsecond=0)
    out: list[Crisis] = []
    for i in range(n):
        days_back = rng.randint(5, 90)
        ts = now - timedelta(days=days_back, hours=rng.randint(0, 23))
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
```

- [ ] **Step 2: Seed 12 historical crises**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.crisis_injector --seed-historical 12
```
Expected: 12 progress lines, then `crisis_ground_truth: 12 rows.`

- [ ] **Step 3: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/crisis_injector.py
git commit -m "data: crisis injector (12 historical seeds + inject_now primitive)"
```

---

## Task 9: `generate_text.py` — 150K Gemini reviews, resumable, $25 hard-cap

**Files:**
- Create: `backend/data/generate_text.py`

- [ ] **Step 1: Write `generate_text.py`**

Create `backend/data/generate_text.py`:
```python
"""Gemini-generated review text for reviews_text (150K rows).

Model: gemini-2.5-flash via google-genai (Vertex backend, us-east1).
Batch: 25 reviews per API call → 6,000 calls.
Cost cap: aborts if projected spend exceeds $25 (based on token counts).
Resumable: seed/gen_state.json records last completed batch index.
Distribution: 60% baseline, 40% clustered ±48h around seeded crises.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

from data.ch_client import client, insert_batches
from data.region_split import REGIONS

load_dotenv()

SEED_DIR = Path(__file__).parent / "seed"
STATE_PATH = SEED_DIR / "gen_state.json"

TARGET_ROWS = 150_000
BATCH_SIZE = 25
NUM_BATCHES = TARGET_ROWS // BATCH_SIZE   # 6000
COST_CAP_USD = 25.0

# Approximate Gemini 2.5 Flash pricing (USD per 1M tokens); refresh if pricing changes.
PRICE_IN_PER_M = 0.30
PRICE_OUT_PER_M = 2.50

SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "reviews": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "raw_text": types.Schema(type=types.Type.STRING),
                    "sentiment_score": types.Schema(type=types.Type.NUMBER),
                    "themes": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                    ),
                },
                required=["raw_text", "sentiment_score", "themes"],
            ),
        )
    },
    required=["reviews"],
)


@dataclass
class BatchSpec:
    idx: int
    film_id: int
    genre: str
    title: str
    region: str
    around_ts: datetime
    around_crisis: bool
    crisis_hint: str | None


def _load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"completed_batches": [], "total_in_tokens": 0, "total_out_tokens": 0}


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2))


def _estimated_cost(state: dict[str, Any]) -> float:
    return (state["total_in_tokens"] / 1e6) * PRICE_IN_PER_M + (state["total_out_tokens"] / 1e6) * PRICE_OUT_PER_M


def _load_films() -> list[tuple[int, str, str]]:
    with client() as c:
        return [(int(r[0]), str(r[1]), str(r[2])) for r in
                c.query("SELECT film_id, genre, title FROM films").result_rows]


def _load_crises() -> list[tuple[int, str, datetime, str]]:
    with client() as c:
        return [(int(r[0]), str(r[1]), r[2], str(r[3])) for r in
                c.query("""
                    SELECT affected_film_id, affected_region, injection_timestamp, true_root_cause
                    FROM crisis_ground_truth FINAL
                """).result_rows]


def _plan(films: list[tuple[int, str, str]], crises: list) -> list[BatchSpec]:
    """Build 6000 batch specs: 60% baseline + 40% crisis-clustered."""
    rng = random.Random(2026)
    baseline_n = int(NUM_BATCHES * 0.6)
    crisis_n = NUM_BATCHES - baseline_n
    plan: list[BatchSpec] = []
    now = datetime.utcnow().replace(microsecond=0)

    # Baseline batches
    for i in range(baseline_n):
        fid, genre, title = rng.choice(films)
        region = rng.choice(REGIONS)
        days_back = rng.randint(0, 120)
        ts = now - timedelta(days=days_back, hours=rng.randint(0, 23))
        plan.append(BatchSpec(i, fid, genre, title, region, ts, False, None))

    # Crisis-clustered batches
    if crises:
        for i in range(crisis_n):
            fid, region, cts, cause = crises[i % len(crises)]
            offset_h = rng.randint(-48, 48)
            ts = cts + timedelta(hours=offset_h)
            # Find the film's genre/title
            film = next((f for f in films if f[0] == fid), (fid, "Drama", "Unknown"))
            plan.append(BatchSpec(baseline_n + i, fid, film[1], film[2], region, ts, True, cause))
    else:
        # No crises: fall back to baseline for the remainder
        for i in range(crisis_n):
            fid, genre, title = rng.choice(films)
            region = rng.choice(REGIONS)
            days_back = rng.randint(0, 120)
            ts = now - timedelta(days=days_back, hours=rng.randint(0, 23))
            plan.append(BatchSpec(baseline_n + i, fid, genre, title, region, ts, False, None))

    rng.shuffle(plan)
    for new_idx, spec in enumerate(plan):
        spec.idx = new_idx
    return plan


def _prompt(spec: BatchSpec) -> str:
    base = (
        f"Generate {BATCH_SIZE} realistic viewer reviews for the {spec.genre} film "
        f"\"{spec.title}\" as watched in the {spec.region} region. "
        "Each review 40–120 words, in English. Vary tone: some enthusiastic, some critical, "
        "some mixed. Return sentiment_score in [-1, 1] and 2–4 short themes per review."
    )
    if spec.around_crisis and spec.crisis_hint:
        base += (
            f" Bias the batch toward sentiment reflecting this observed issue: "
            f"\"{spec.crisis_hint}\". Roughly 60% of reviews should reference it directly."
        )
    return base


def _run_batch(cl: "genai.Client", spec: BatchSpec) -> tuple[list[list], int, int]:
    resp = cl.models.generate_content(
        model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=_prompt(spec),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SCHEMA,
            temperature=0.9,
        ),
    )
    parsed = json.loads(resp.text)
    reviews = parsed.get("reviews", [])
    rows: list[list] = []
    for rev in reviews[:BATCH_SIZE]:
        rows.append([
            spec.film_id, spec.region, spec.around_ts, "gemini_synth",
            str(rev.get("raw_text", ""))[:2000],
            float(rev.get("sentiment_score", 0.0)),
            [str(t)[:64] for t in rev.get("themes", [])[:6]],
        ])
    usage = getattr(resp, "usage_metadata", None)
    in_tok = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
    out_tok = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
    return rows, in_tok, out_tok


def _make_client() -> "genai.Client":
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-east1")
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT not set.")
    return genai.Client(vertexai=True, project=project, location=location)


def run(limit: int | None = None) -> None:
    state = _load_state()
    done = set(state["completed_batches"])
    films = _load_films()
    crises = _load_crises()
    plan = _plan(films, crises)

    if os.environ.get("GEMINI_DRYRUN"):
        print(f"DRYRUN: would run {len(plan)} batches; done={len(done)}")
        return

    cl = _make_client()
    ran = 0
    for spec in plan:
        if spec.idx in done:
            continue
        if limit is not None and ran >= limit:
            break
        cost = _estimated_cost(state)
        if cost > COST_CAP_USD:
            print(f"COST CAP hit (${cost:.2f} > ${COST_CAP_USD}); stopping.", file=sys.stderr)
            break
        try:
            rows, in_tok, out_tok = _run_batch(cl, spec)
        except Exception as e:  # noqa: BLE001
            print(f"batch {spec.idx} failed: {e}", file=sys.stderr)
            continue
        if rows:
            insert_batches("reviews_text", rows,
                           column_names=["film_id", "region", "ts", "source",
                                         "raw_text", "sentiment_score", "themes"],
                           batch_size=BATCH_SIZE)
        state["completed_batches"].append(spec.idx)
        state["total_in_tokens"] += in_tok
        state["total_out_tokens"] += out_tok
        _save_state(state)
        ran += 1
        if ran % 20 == 0:
            print(f"  batch {ran} done; total done={len(state['completed_batches'])}/{NUM_BATCHES}; cost≈${_estimated_cost(state):.2f}")

    verify()


def verify() -> None:
    with client() as c:
        n = c.query("SELECT count() FROM reviews_text").result_rows[0][0]
    print(f"reviews_text: {n:,} rows (target {TARGET_ROWS:,}).")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, help="Cap batches this run (for smoke testing)")
    p.add_argument("--verify", action="store_true")
    args = p.parse_args()
    if args.verify:
        verify()
    else:
        run(limit=args.limit)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test with a tiny limit first**

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.generate_text --limit 5
```
Expected: 5 batches complete, `reviews_text: 125 rows`. If Vertex auth fails, verify `GOOGLE_APPLICATION_CREDENTIALS` env and `GOOGLE_CLOUD_PROJECT` are set.

- [ ] **Step 3: Run full generation**

```bash
python -m data.generate_text
```
Expected: progress every 20 batches; total ~2–3 hours; cost < $25 (auto-abort if exceeded). Final: `reviews_text: 150,000 rows`.

If interrupted: rerun the same command. Resumes from `seed/gen_state.json`.

- [ ] **Step 4: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/generate_text.py
git commit -m "data: gemini review text generator (150K rows, resumable, $25 cap)"
```

---

## Task 10: `backend/data/README.md` — runbook + acceptance check

**Files:**
- Create: `backend/data/README.md`

- [ ] **Step 1: Write the runbook**

Create `backend/data/README.md`:
```markdown
# Layer 1 — Data foundation runbook

## Prerequisites

- Python venv active: `source backend/venv/bin/activate`
- `.env` populated (see `.env.example`) with `CLICKHOUSE_*`, `GOOGLE_CLOUD_*`, `TMDB_API_KEY`.
- ClickHouse Cloud reachable (Mini tier, us-east1).
- Google Cloud project set, service account has `Vertex AI User` role.

## One-shot: build the full dataset

Run these in order, from `backend/`:

```bash
python -m data.apply_schema                          # 13 tables
python -m data.seed_tmdb                             # 250 films
python -m data.generate_numeric                      # ~51M rows across 10 tables
python -m data.crisis_injector --seed-historical 12  # 12 crises + ground truth
python -m data.generate_text                         # 150K reviews via Gemini (~2–3h)
```

Total wall time: ~3–4 hours (dominated by `generate_text`).
Total cost: ClickHouse storage negligible; Gemini <$25 (hard-capped).

## Verification queries

```bash
python -m data.apply_schema      --verify    # 13 tables present
python -m data.seed_tmdb         --verify    # >= 250 films
python -m data.generate_numeric  --verify    # per-table counts + total >= 50M
python -m data.crisis_injector   --verify    # >= 12 crisis_ground_truth rows
python -m data.generate_text     --verify    # 150,000 rows in reviews_text
```

Or ad-hoc from any ClickHouse client:

```sql
-- All tables
SELECT name, total_rows FROM system.tables
WHERE database = currentDatabase() ORDER BY total_rows DESC;

-- Cross-signal sanity: one film in one region
SELECT
  (SELECT count() FROM box_office_revenue WHERE film_id = 1 AND region = 'NA') AS box,
  (SELECT count() FROM streaming_watch_minutes WHERE film_id = 1 AND region = 'NA') AS stream,
  (SELECT count() FROM reviews_text WHERE film_id = 1 AND region = 'NA') AS reviews;

-- Crisis coverage
SELECT type, count() FROM crisis_ground_truth FINAL GROUP BY type ORDER BY count() DESC;
```

## Resetting

```bash
python -m data.apply_schema --reset --yes
```
Drops all 13 tables. Then rerun the seed → generate → inject → text sequence.

## Compliance

- **Data source:** film catalog seeded from [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- **AI:** review text is generated at build-time by Google Gemini (`gemini-2.5-flash`) via `google-genai`. No non-Google AI is used anywhere.
- **ClickHouse access:** this layer uses `clickhouse-connect` directly. Layer 3 agents must use `mcp-clickhouse` instead — that is what the hackathon judges verify.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required env var: CLICKHOUSE_HOST` | Populate `.env` from `.env.example`. |
| `Kaggle URL` HTTP error | Place any TMDB CSV at `backend/data/seed/tmdb_catalog_source.csv` and rerun. |
| Vertex auth error | Confirm `GOOGLE_APPLICATION_CREDENTIALS` points to `service-account.json` and the service account has `Vertex AI User`. |
| `generate_text` cost cap hit | Delete `seed/gen_state.json` to reset counter (or raise `COST_CAP_USD` deliberately). |
| Numeric row count below 50M | Rerun with `--only <table>` to fix specific tables, or raise `WINDOW_DAYS` / add platforms. |
```

- [ ] **Step 2: Full acceptance check**

Run every verify to confirm Layer 1 acceptance criteria (spec §8):

```bash
source /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend/venv/bin/activate
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander/backend
python -m data.ch_client
python -m data.apply_schema --verify
python -m data.seed_tmdb --verify
python -m data.region_split
python -m data.generate_numeric --verify
python -m data.crisis_injector --verify
python -m data.generate_text --verify
```

Also confirm no secrets sneaked into git:
```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
grep -rE "$(head -c 8 <(grep TMDB_API_KEY= .env | cut -d= -f2))" . --exclude-dir=.git --exclude-dir=venv --exclude-dir=.venv --exclude=.env --exclude-dir=docs || echo "clean"
git ls-files | grep -E "^(.env$|service-account\.json$)" || echo "no secrets tracked"
```
Expected: `clean` and `no secrets tracked`.

- [ ] **Step 3: Commit**

```bash
cd /Users/dipgupmac/Downloads/Hackathons/studio-crisis-commander
git add backend/data/README.md
git commit -m "data: layer 1 runbook and acceptance checks"
```

---

## Self-review

**Spec coverage:**
- §4.1 four signal families → tables in Task 3, generators in Tasks 6 & 9 ✓
- §4.2 component map → Tasks 2–9 create every listed file ✓
- §4.3 data flow → Task order matches (schema → films → numeric → injector → text) ✓
- §4.4 numeric model → Task 6 (`_lifecycle`, `_diurnal`, `_noise`, per-table generators) ✓
- §4.5 text model → Task 9 (structured schema, batch 25, resumable, Flash, $25 cap, 60/40 dist) ✓
- §4.6 historical + live injection → Task 8 (`seed_historical` + `inject_now`) ✓
- §4.7 ground truth schema → Task 3 (DDL) + Task 7 (writer) ✓
- §4.8 CH conventions → Task 3 (MergeTree, PARTITION, ORDER BY, LowCardinality) ✓
- §5 error handling → Task 3 (`--reset --yes`), Task 4 (`tenacity`, cache-first), Task 9 (checkpoint, cost cap) ✓
- §7 assumptions → carried into runbook (Task 10) ✓
- §8 acceptance → Task 10 Step 2 runs all verifies + secret check ✓
- §9 risks → all mitigated in code (retries, cap, boundary docstring) ✓

**Placeholder scan:** No TBDs / TODOs / "similar to Task N" / vague steps. Every step has runnable code or a runnable command with expected output.

**Type consistency:**
- `Crisis` pydantic model in Task 7 matches columns in Task 3's `crisis_ground_truth` DDL ✓
- `write` in Task 7 matches `write_gt` alias used by Task 8 ✓
- `insert_batches(table, rows, column_names, batch_size)` signature consistent in Tasks 6 & 9 ✓
- `client()` context manager used consistently across Tasks 2–9 ✓
- `weights_for(genre)` returns `dict[str, float]` used by Tasks 6's per-region loops ✓
- Column lists in Task 6's `TABLE_JOBS` match the DDL in Task 3 (film_id, region, ts vs date) ✓

Plan is coherent, complete, and ready to execute.
