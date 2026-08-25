"""Static + dynamic shelf definitions for the Movies Index route.

Column reality (from backend/data/schema.sql):
  - films table PK is `film_id`; `tmdb_id` is the join key for poster paths.
  - poster URLs are built from `backend/data/seed/poster_paths.json`, populated
    by `scripts/backfill_posters.py`. Films missing from the map render the
    frontend's gradient placeholder.
  - box_office_revenue has `date` (Date), revenue_usd; other numeric tables use
    `ts` (DateTime).
  - social_trends.mentions, streaming_watch_minutes.watch_minutes, review_scores.score.
  - detections table is `detections` (not `detections_stream`); uses `metric_ts`.

Featured status is derived from `data/eval_cache/*.json` — each cached scenario
file pins one (film_id, region) triple. Films whose id appears in a cache file
are "featured" (Movie Detail page can mount instantly, no live-run cost).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import data as _data_pkg
from data.ch_client import client

log = logging.getLogger(__name__)

# Resolve via the `data` package so paths work in both layouts:
#   local dev  → <repo>/backend/data/
#   container  → /app/data/  (Dockerfile flattens backend/data → /app/data)
_DATA_ROOT = Path(_data_pkg.__file__).resolve().parent
_POSTER_JSON = _DATA_ROOT / "seed" / "poster_paths.json"
_TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w342"

# Cached demo triples: prefer the container path (/app/data/eval_cache,
# staged by deploy_backend.sh) and fall back to the repo-root copy for
# local dev. Match the resolver in api/main.py so both mount and shelf
# picks stay in sync.
_CACHE_CANDIDATES = [
    Path(__file__).resolve().parents[2] / "data" / "eval_cache",  # /app/data/eval_cache
    Path(__file__).resolve().parents[3] / "data" / "eval_cache",  # <repo>/data/eval_cache
]
_CACHE_DIR = next((p for p in _CACHE_CANDIDATES if p.is_dir()), _CACHE_CANDIDATES[0])


def _load_poster_map() -> dict[int, str]:
    """Load tmdb_id → poster_path map, returning full CDN URLs by tmdb_id."""
    if not _POSTER_JSON.is_file():
        log.warning("poster_paths.json missing — run scripts/backfill_posters.py")
        return {}
    try:
        raw = json.loads(_POSTER_JSON.read_text())
    except Exception:  # noqa: BLE001
        log.warning("poster_paths.json unreadable", exc_info=True)
        return {}
    out: dict[int, str] = {}
    for k, v in raw.items():
        try:
            tid = int(k)
        except (TypeError, ValueError):
            continue
        if isinstance(v, str) and v:
            out[tid] = f"{_TMDB_IMG_BASE}{v}"
    return out


_POSTER_BY_TMDB: dict[int, str] = _load_poster_map()


def _tmdb_ids_for(film_ids: list[int]) -> dict[int, int]:
    """film_id → tmdb_id map for the given film_ids."""
    if not film_ids:
        return {}
    ids_list = ",".join(str(int(x)) for x in film_ids)
    with client() as c:
        rows = list(c.query(
            f"SELECT film_id, tmdb_id FROM films WHERE film_id IN ({ids_list})"
        ).result_rows)
    return {int(r[0]): int(r[1]) for r in rows}


def _poster_for(film_id: int, tmdb_lookup: dict[int, int]) -> str:
    tid = tmdb_lookup.get(int(film_id))
    if tid is None:
        return ""
    return _POSTER_BY_TMDB.get(int(tid), "")


def _cached_film_map() -> dict[int, str]:
    """film_id → scenario_id, for the first cached scenario per film."""
    if not _CACHE_DIR.is_dir():
        return {}
    out: dict[int, str] = {}
    for p in sorted(_CACHE_DIR.glob("*.json")):
        sid = p.stem
        try:
            payload = json.loads(p.read_text())
            fid = int(payload.get("detection", {}).get("film_id", -1))
            if fid > 0 and fid not in out:
                out[fid] = sid
        except Exception:  # noqa: BLE001
            log.warning("bad cache file %s", sid, exc_info=True)
    return out


def _cached_scenario_ids() -> list[str]:
    """Sorted list of every cached scenario_id — used as a round-robin
    fallback so films without their own triple still surface an example
    investigation on the Movie Detail page."""
    if not _CACHE_DIR.is_dir():
        return []
    return sorted(p.stem for p in _CACHE_DIR.glob("*.json"))


def _cached_magnitudes() -> dict[int, float]:
    """film_id → magnitude from the film's cached scenario. Used by the
    Featured shelf so each card shows a real crisis intensity instead of
    the hardcoded 0.0 placeholder."""
    if not _CACHE_DIR.is_dir():
        return {}
    out: dict[int, float] = {}
    for p in sorted(_CACHE_DIR.glob("*.json")):
        try:
            payload = json.loads(p.read_text())
            det = payload.get("detection", {})
            fid = int(det.get("film_id", -1))
            mag = float(det.get("magnitude", 0.0))
            if fid > 0 and fid not in out:
                out[fid] = mag
        except Exception:  # noqa: BLE001
            log.warning("bad cache file %s", p.stem, exc_info=True)
    return out


def _query_rows(c: Any, sql: str) -> list[tuple]:
    try:
        return list(c.query(sql).result_rows)
    except Exception:  # noqa: BLE001
        log.warning("catalog query failed: %s", sql, exc_info=True)
        return []


def _top_regions_for(c: Any, film_ids: list[int], k: int = 6) -> dict[int, list[dict[str, Any]]]:
    """film_id → top-K regions by combined signal volume in the last 7d, with
    delta_pct vs the prior 7d. One query per film would be O(N) round-trips;
    this batches with WHERE film_id IN (…) and groups per film in Python.

    We aggregate box_office_revenue only — it's the smallest table and the
    "which markets matter" signal doesn't need to be precise for the card
    strip. If it becomes an issue we can widen to a UNION over rollups.
    """
    if not film_ids:
        return {}
    ids_list = ",".join(str(int(x)) for x in film_ids)
    cur_sql = (
        f"SELECT film_id, region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id IN ({ids_list}) "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 7 DAY "
        f"GROUP BY film_id, region"
    )
    prev_sql = (
        f"SELECT film_id, region, sum(revenue_usd) AS vol "
        f"FROM box_office_revenue "
        f"WHERE film_id IN ({ids_list}) "
        f"AND date < coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 7 DAY "
        f"AND date >= coalesce("
        f"  (SELECT max(date) FROM box_office_revenue WHERE film_id IN ({ids_list})),"
        f"  today()) - INTERVAL 14 DAY "
        f"GROUP BY film_id, region"
    )
    cur_rows = _query_rows(c, cur_sql)
    prev_rows = _query_rows(c, prev_sql)
    cur_map: dict[tuple[int, str], float] = {}
    for r in cur_rows:
        cur_map[(int(r[0]), str(r[1]))] = float(r[2]) if r[2] is not None else 0.0
    prev_map: dict[tuple[int, str], float] = {}
    for r in prev_rows:
        prev_map[(int(r[0]), str(r[1]))] = float(r[2]) if r[2] is not None else 0.0

    by_film: dict[int, list[tuple[str, float, float]]] = {}
    for (fid, region), cur in cur_map.items():
        prev = prev_map.get((fid, region), 0.0)
        if prev <= 0.0:
            delta = 0.0 if cur <= 0.0 else 100.0
        else:
            delta = round(((cur - prev) / prev) * 100.0, 2)
        by_film.setdefault(fid, []).append((region, cur, delta))
    out: dict[int, list[dict[str, Any]]] = {}
    for fid, entries in by_film.items():
        entries.sort(key=lambda x: x[1], reverse=True)  # highest volume first
        out[fid] = [
            {"code": region, "delta_pct": delta}
            for region, _vol, delta in entries[:k]
        ]
    return out


def _to_card(row: tuple) -> dict[str, Any]:
    # Rows are (film_id, title, [signal_delta, region_hint]). Missing tail
    # elements default to 0.0 and "". poster_url is filled in later by
    # `_attach_posters` once we know every film_id in the batch.
    return {
        "id": int(row[0]),
        "title": row[1] or "",
        "poster_url": "",
        "signal_delta": float(row[2]) if len(row) > 2 and row[2] is not None else 0.0,
        "region_hint": row[3] if len(row) > 3 and row[3] is not None else "",
    }


def _attach_posters(cards_by_shelf: list[list[dict[str, Any]]]) -> None:
    """Fill in poster_url on every card, using one film→tmdb lookup batch."""
    ids: set[int] = set()
    for shelf in cards_by_shelf:
        for card in shelf:
            ids.add(int(card["id"]))
    if not ids:
        return
    tmdb_lookup = _tmdb_ids_for(sorted(ids))
    for shelf in cards_by_shelf:
        for card in shelf:
            card["poster_url"] = _poster_for(int(card["id"]), tmdb_lookup)


MIN_SHELF_CARDS = 4


def _popular_films(c: Any, exclude: set[int], want: int) -> list[dict[str, Any]]:
    """Popularity-ranked filler for shelves that came back sparse.

    Every shelf on the Movies index needs to look populated for the demo; if
    a signal-driven query returns fewer than MIN_SHELF_CARDS rows (common
    when synthetic data is older than the shelf's time window), we top it up
    from the ordered popularity list. Excludes ids already on the shelf.
    """
    if want <= 0:
        return []
    excl = ",".join(str(int(x)) for x in exclude) or "0"
    rows = _query_rows(
        c,
        f"SELECT film_id, title, 0.0 AS delta, '' AS region FROM films "
        f"WHERE film_id NOT IN ({excl}) "
        f"ORDER BY popularity DESC LIMIT {int(want)}"
    )
    return [_to_card(r) for r in rows]


def _topup(c: Any, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(cards) >= MIN_SHELF_CARDS:
        return cards
    ids = {int(x["id"]) for x in cards}
    filler = _popular_films(c, exclude=ids, want=MIN_SHELF_CARDS - len(cards))
    return cards + filler


def build_shelves(region: str | None = None) -> list[dict[str, Any]]:
    shelves: list[dict[str, Any]] = []
    featured_film_ids = set(_cached_film_map().keys())

    with client() as c:
        # Shelf 1 — Featured.
        # If eval_cache/*.json is bundled, prefer those (pre-recorded triples
        # mean Movie Detail can mount instantly). If not (current prod image),
        # fall back to popular films so the shelf isn't empty.
        if featured_film_ids:
            ids_list = ",".join(str(int(x)) for x in featured_film_ids)
            featured_films = [
                _to_card(r) for r in _query_rows(
                    c,
                    f"SELECT film_id, title, 0.0 AS delta, '' AS region "
                    f"FROM films WHERE film_id IN ({ids_list}) "
                    f"ORDER BY popularity DESC LIMIT 12"
                )
            ]
        else:
            featured_films = _popular_films(c, exclude=set(), want=8)
        mags = _cached_magnitudes()
        for f in featured_films:
            f["featured"] = True
            # Surface the cached-scenario magnitude so the card shows a real
            # crisis intensity instead of the SELECT placeholder.
            if int(f["id"]) in mags:
                f["signal_delta"] = mags[int(f["id"])]
        shelves.append({
            "id": "featured",
            "title": "Featured — pre-run investigations",
            "films": featured_films,
        })

        # Shelf 2 — Trending in region. Anchor on max(date) for the region,
        # not today(), so the shelf populates even when synthetic data is
        # older than 7 days (same fix pattern as /detections).
        if region:
            safe_region = region.replace("'", "''")
            trend_cards = [
                _to_card(r) for r in _query_rows(
                    c,
                    f"SELECT f.film_id, f.title, "
                    f"sum(b.revenue_usd) AS delta, '{safe_region}' AS region "
                    f"FROM films f JOIN box_office_revenue b ON f.film_id = b.film_id "
                    f"WHERE b.region = '{safe_region}' AND b.date >= coalesce("
                    f"  (SELECT max(date) FROM box_office_revenue "
                    f"    WHERE region = '{safe_region}'), today()) - 7 "
                    f"GROUP BY f.film_id, f.title "
                    f"ORDER BY delta DESC LIMIT 12"
                )
            ]
            shelves.append({
                "id": "trending_region",
                "title": f"Trending in {region}",
                "films": _topup(c, trend_cards),
            })

        # Shelf 3 — Streaming climbers (window from max(ts)).
        streaming = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, sum(st.watch_minutes) AS delta, "
                "any(st.region) AS region "
                "FROM streaming_watch_minutes st JOIN films f ON st.film_id = f.film_id "
                "WHERE st.ts >= coalesce("
                "  (SELECT max(ts) FROM streaming_watch_minutes), now()) - INTERVAL 7 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "streaming",
            "title": "Streaming climbers",
            "films": _topup(c, streaming),
        })

        # Shelf 6 — Full catalog (first page of newest releases).
        full = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT film_id, title, 0.0 AS delta, '' AS region FROM films "
                "ORDER BY release_date DESC LIMIT 24"
            )
        ]
        shelves.append({"id": "all", "title": "All movies", "films": full})

        # Attach top_regions to every card in one batched query
        all_ids = sorted({int(f["id"]) for s in shelves for f in s["films"]})
        top_map = _top_regions_for(c, all_ids, k=6)

    _attach_posters([s["films"] for s in shelves])
    for shelf in shelves:
        for card in shelf["films"]:
            card["top_regions"] = top_map.get(int(card["id"]), [])
    return shelves


def get_film(film_id: int) -> dict[str, Any] | None:
    cached_map = _cached_film_map()
    all_scenarios = _cached_scenario_ids()
    with client() as c:
        rows = _query_rows(
            c,
            f"SELECT film_id, title, toString(release_date), popularity, language, tmdb_id, "
            f"genre, runtime_min, budget_usd, revenue_usd, vote_average "
            f"FROM films WHERE film_id = {int(film_id)} LIMIT 1",
        )
        if not rows:
            return None
        row = rows[0]

        # Total rows per family for this film, not a rolling 7-day window.
        # Same reasoning as intake.py: max(ts|date) can land on a partition
        # tail with almost no rows for a specific film, and a 7-day filter
        # then collapses to 0. The tile is honest as a footprint number.
        signals: dict[str, int] = {}
        for family, table in (
            ("box_office", "box_office_revenue"),
            ("social",     "social_trends"),
            ("reviews",    "review_scores"),
            ("streaming",  "streaming_watch_minutes"),
        ):
            r = _query_rows(c, f"SELECT count() FROM {table} WHERE film_id = {int(film_id)}")
            signals[family] = int(r[0][0]) if r else 0

    tmdb_id = int(row[5]) if len(row) > 5 and row[5] is not None else 0
    poster_url = _POSTER_BY_TMDB.get(tmdb_id, "")
    # cached_scenario_id: prefer the film's own triple if one exists; otherwise
    # round-robin from the cached pool so every Movie Detail page has an
    # example investigation to render. `featured` stays true only for films
    # that own their triple, so the shelf and badge remain honest.
    own_scenario = cached_map.get(film_id)
    fallback_scenario = (
        all_scenarios[film_id % len(all_scenarios)]
        if not own_scenario and all_scenarios
        else None
    )
    return {
        "id": int(row[0]),
        "title": row[1] or "",
        "poster_url": poster_url,
        "release_date": row[2] if row[2] is not None else "",
        "popularity": float(row[3]) if row[3] is not None else 0.0,
        "language": row[4] if len(row) > 4 and row[4] is not None else "",
        "genre": row[6] if len(row) > 6 and row[6] is not None else "",
        "runtime_min": int(row[7]) if len(row) > 7 and row[7] is not None else 0,
        "budget_usd": int(row[8]) if len(row) > 8 and row[8] is not None else 0,
        "revenue_usd": int(row[9]) if len(row) > 9 and row[9] is not None else 0,
        "vote_average": float(row[10]) if len(row) > 10 and row[10] is not None else 0.0,
        "signals": signals,
        "featured": film_id in cached_map,
        "cached_scenario_id": own_scenario or fallback_scenario,
        "cached_scenario_is_own": bool(own_scenario),
    }


def search_films(q: str, limit: int = 20) -> list[dict[str, Any]]:
    if not q:
        return []
    safe = q.replace("'", "''")
    with client() as c:
        rows = _query_rows(
            c,
            f"SELECT film_id, title, tmdb_id FROM films "
            f"WHERE positionCaseInsensitive(title, '{safe}') > 0 "
            f"ORDER BY popularity DESC LIMIT {int(limit)}"
        )
    return [
        {
            "id": int(r[0]),
            "title": r[1] or "",
            "poster_url": _POSTER_BY_TMDB.get(int(r[2]) if r[2] is not None else 0, ""),
        }
        for r in rows
    ]
