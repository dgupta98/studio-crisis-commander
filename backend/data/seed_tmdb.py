"""Fetch TMDB catalog (Kaggle direct URL) + live per-film signals; seed `films` table.

TMDB attribution required: this product uses the TMDB API but is not
endorsed or certified by TMDB. See README.md.
"""

from __future__ import annotations

import argparse
import io
import os
import random
import re
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
    genre_c = col("genres", "genre", "movie_genre")
    lang_c = col("original_language", "language", "movie_language")
    date_c = col("release_date", "released", "movie_release_date")
    runtime_c = col("runtime", "movie_runtime")
    budget_c = col("budget", "movie_budget")
    rev_c = col("revenue", "gross", "movie_revenue")

    required = [title_c, id_c, date_c]
    if any(x is None for x in required):
        raise RuntimeError(
            f"Catalog missing required columns; got: {list(df.columns)}"
        )

    df = df.dropna(subset=[title_c, id_c, date_c])
    # Normalize dates: accept YYYY-MM-DD or DD-MM-YYYY; convert latter to ISO.
    def _normalize_date(v: Any) -> str:
        s = str(v).strip()
        if re.match(r"\d{4}-\d{2}-\d{2}", s):
            return s[:10]
        m = re.match(r"(\d{2})-(\d{2})-(\d{4})", s)
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        return s

    df = df.copy()
    df[date_c] = df[date_c].apply(_normalize_date)
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
        from datetime import date as _date
        rd = f.release_date[:10]
        release = _date.fromisoformat(rd) if rd else _date(1970, 1, 1)
        rows.append([
            f.film_id, f.tmdb_id, f.title, f.genre, f.language,
            release, f.runtime_min, f.budget_usd, f.revenue_usd,
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
