"""Fetch TMDB catalog (via /discover) + per-film details; seed `films` table.

TMDB attribution required: this product uses the TMDB API but is not
endorsed or certified by TMDB. See README.md.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from datetime import date
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

TMDB_API_BASE = "https://api.themoviedb.org/3"

TARGET_FILM_COUNT = 250
DISCOVER_PAGES = 15  # 20 results/page → 300 candidates, filtered to 250


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


def _require_tmdb_key() -> str:
    key = os.environ.get("TMDB_API_KEY")
    if not key:
        raise RuntimeError("TMDB_API_KEY not set — required for catalog fetch.")
    return key


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


def _fetch_genre_map(key: str) -> dict[int, str]:
    r = _get(f"{TMDB_API_BASE}/genre/movie/list", params={"api_key": key})
    return {int(g["id"]): str(g["name"]) for g in r.json().get("genres", [])}


def _fetch_catalog_from_tmdb() -> pd.DataFrame:
    """Discover top films sorted by popularity. Returns real tmdb_ids."""
    key = _require_tmdb_key()
    genre_map = _fetch_genre_map(key)
    rows: list[dict[str, Any]] = []
    for page in range(1, DISCOVER_PAGES + 1):
        r = _get(
            f"{TMDB_API_BASE}/discover/movie",
            params={
                "api_key": key,
                "sort_by": "popularity.desc",
                "include_adult": "false",
                "page": page,
            },
        )
        for m in r.json().get("results", []):
            if not m.get("release_date"):
                continue
            gids = m.get("genre_ids") or []
            primary = genre_map.get(int(gids[0]), "Drama") if gids else "Drama"
            rows.append(
                {
                    "tmdb_id": int(m["id"]),
                    "title": str(m.get("title") or m.get("original_title") or "")[:255],
                    "genre": primary,
                    "language": str(m.get("original_language", "en"))[:2],
                    "release_date": str(m["release_date"])[:10],
                    "popularity_discover": float(m.get("popularity", 0.0)),
                    "vote_average_discover": float(m.get("vote_average", 0.0)),
                }
            )
        time.sleep(0.05)
    print(f"  discovered {len(rows)} films across {DISCOVER_PAGES} pages")
    return pd.DataFrame(rows)


def _pick_films(df: pd.DataFrame, n: int) -> list[FilmSeed]:
    df = df.dropna(subset=["tmdb_id", "title", "release_date"])
    df = df[df["release_date"].astype(str).str.match(r"\d{4}-\d{2}-\d{2}")]
    # ClickHouse Date is 1970-01-01..2149; drop anything earlier.
    df = df[df["release_date"] >= "1970-01-01"]
    df = df.drop_duplicates(subset=["tmdb_id"])
    df = df.sort_values("popularity_discover", ascending=False).head(n).reset_index(drop=True)
    out: list[FilmSeed] = []
    for i, row in df.iterrows():
        out.append(
            FilmSeed(
                film_id=int(i) + 1,
                tmdb_id=int(row["tmdb_id"]),
                title=str(row["title"]),
                genre=str(row["genre"]),
                language=str(row["language"]),
                release_date=str(row["release_date"]),
                runtime_min=0,
                budget_usd=0,
                revenue_usd=0,
            )
        )
    return out


def _fetch_live_signals(films: list[FilmSeed]) -> pd.DataFrame:
    """Per-film /movie/{id} call: refreshes popularity + fills runtime/budget/revenue."""
    key = _require_tmdb_key()
    rows: list[dict[str, Any]] = []
    for i, f in enumerate(films, 1):
        try:
            r = _get(f"{TMDB_API_BASE}/movie/{f.tmdb_id}", params={"api_key": key})
            j = r.json()
            rows.append(
                {
                    "tmdb_id": f.tmdb_id,
                    "popularity": float(j.get("popularity", 0.0)),
                    "vote_average": float(j.get("vote_average", 0.0)),
                    "runtime_min": int(j.get("runtime") or 100),
                    "budget_usd": int(j.get("budget") or 0),
                    "revenue_usd": int(j.get("revenue") or 0),
                }
            )
        except Exception as e:  # noqa: BLE001
            print(f"TMDB fetch failed for {f.tmdb_id}: {e}", file=sys.stderr)
            rows.append(
                {
                    "tmdb_id": f.tmdb_id,
                    "popularity": 0.0,
                    "vote_average": 0.0,
                    "runtime_min": 100,
                    "budget_usd": 0,
                    "revenue_usd": 0,
                }
            )
        if i % 50 == 0:
            print(f"  fetched {i}/{len(films)}")
        time.sleep(0.05)
    return pd.DataFrame(rows)


def _insert_films(films: list[FilmSeed], live: pd.DataFrame) -> None:
    live_by_id = {int(r["tmdb_id"]): r for _, r in live.iterrows()}
    rows = []
    for f in films:
        lv = live_by_id.get(f.tmdb_id, {})
        rows.append(
            [
                f.film_id,
                f.tmdb_id,
                f.title,
                f.genre,
                f.language,
                date.fromisoformat(f.release_date[:10]),
                int(lv.get("runtime_min") or 100),
                int(lv.get("budget_usd") or 0),
                int(lv.get("revenue_usd") or 0),
                float(lv.get("popularity", 0.0)),
                float(lv.get("vote_average", 0.0)),
            ]
        )
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
        raw = _fetch_catalog_from_tmdb()
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
        avg_pop = c.query("SELECT round(avg(popularity), 2) FROM films").result_rows[0][0]
        real = c.query("SELECT count() FROM films WHERE popularity > 0").result_rows[0][0]
    if n < TARGET_FILM_COUNT:
        print(f"FAIL: films has {n} rows, expected >= {TARGET_FILM_COUNT}", file=sys.stderr)
        sys.exit(1)
    print(f"films OK: {n} rows. avg popularity={avg_pop}, {real}/{n} with real signals.")


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
