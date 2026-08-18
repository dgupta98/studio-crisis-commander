"""Static + dynamic shelf definitions for the Movies Index route.

Column reality (from backend/data/schema.sql):
  - films table PK is `film_id` (not `id`); no poster_url column exists yet.
    We return `poster_url: ""` — the frontend renders a signal-family gradient
    placeholder. A follow-up backfill can populate this.
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

from data.ch_client import client

log = logging.getLogger(__name__)

# repo root: backend/api/catalog/shelves.py → parents[3] is the repo root
_CACHE_DIR = Path(__file__).resolve().parents[3] / "data" / "eval_cache"


def _cached_scenario_ids() -> set[str]:
    if not _CACHE_DIR.is_dir():
        return set()
    return {p.stem for p in _CACHE_DIR.glob("*.json")}


def _cached_film_map() -> dict[int, str]:
    """film_id → scenario_id, for the first cached scenario per film."""
    out: dict[int, str] = {}
    for sid in _cached_scenario_ids():
        try:
            payload = json.loads((_CACHE_DIR / f"{sid}.json").read_text())
            fid = int(payload.get("detection", {}).get("film_id", -1))
            if fid > 0 and fid not in out:
                out[fid] = sid
        except Exception:  # noqa: BLE001
            log.warning("bad cache file %s", sid, exc_info=True)
    return out


def _query_rows(c: Any, sql: str) -> list[tuple]:
    try:
        return list(c.query(sql).result_rows)
    except Exception:  # noqa: BLE001
        log.warning("catalog query failed: %s", sql, exc_info=True)
        return []


def _to_card(row: tuple) -> dict[str, Any]:
    # Rows are (film_id, title, [signal_delta, region_hint]). Missing tail
    # elements default to 0.0 and "".
    return {
        "id": int(row[0]),
        "title": row[1] or "",
        "poster_url": "",
        "signal_delta": float(row[2]) if len(row) > 2 and row[2] is not None else 0.0,
        "region_hint": row[3] if len(row) > 3 and row[3] is not None else "",
    }


def build_shelves(region: str | None = None) -> list[dict[str, Any]]:
    shelves: list[dict[str, Any]] = []
    featured_film_ids = set(_cached_film_map().keys())

    with client() as c:
        # Shelf 1 — Featured (films with pre-recorded triples in eval_cache).
        # Order by popularity so the strongest posters lead the row.
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
            featured_films = []
        for f in featured_films:
            f["featured"] = True
        shelves.append({
            "id": "featured",
            "title": "Featured — pre-run investigations",
            "films": featured_films,
        })

        # Shelf 2 — Trending in region (last 7 days of box_office_revenue)
        if region:
            safe_region = region.replace("'", "''")
            trend = [
                _to_card(r) for r in _query_rows(
                    c,
                    f"SELECT f.film_id, f.title, "
                    f"sum(b.revenue_usd) AS delta, '{safe_region}' AS region "
                    f"FROM films f LEFT JOIN box_office_revenue b ON f.film_id = b.film_id "
                    f"WHERE b.region = '{safe_region}' AND b.date >= today() - 7 "
                    f"GROUP BY f.film_id, f.title "
                    f"ORDER BY delta DESC LIMIT 12"
                )
            ]
            shelves.append({
                "id": "trending_region",
                "title": f"Trending in {region}",
                "films": trend,
            })

        # Shelf 3 — Recent detections (last 24h)
        recent = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, max(d.magnitude) AS delta, "
                "any(d.region) AS region "
                "FROM detections d JOIN films f ON d.film_id = f.film_id "
                "WHERE d.metric_ts >= now() - INTERVAL 1 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "recent_detections",
            "title": "Recent detections",
            "films": recent,
        })

        # Shelf 4 — Social storms (last 3 days of social_trends.mentions)
        social = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, sum(s.mentions) AS delta, "
                "any(s.region) AS region "
                "FROM social_trends s JOIN films f ON s.film_id = f.film_id "
                "WHERE s.ts >= now() - INTERVAL 3 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "social_storms",
            "title": "Social storms",
            "films": social,
        })

        # Shelf 5 — Streaming climbers (last 7 days watch_minutes)
        streaming = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT f.film_id, f.title, sum(st.watch_minutes) AS delta, "
                "any(st.region) AS region "
                "FROM streaming_watch_minutes st JOIN films f ON st.film_id = f.film_id "
                "WHERE st.ts >= now() - INTERVAL 7 DAY "
                "GROUP BY f.film_id, f.title "
                "ORDER BY delta DESC LIMIT 12"
            )
        ]
        shelves.append({
            "id": "streaming",
            "title": "Streaming climbers",
            "films": streaming,
        })

        # Shelf 6 — Full catalog (paginated in later task; first page here)
        full = [
            _to_card(r) for r in _query_rows(
                c,
                "SELECT film_id, title, 0.0 AS delta, '' AS region FROM films "
                "ORDER BY release_date DESC LIMIT 24"
            )
        ]
        shelves.append({"id": "all", "title": "All films", "films": full})

    return shelves


def get_film(film_id: int) -> dict[str, Any] | None:
    cached_map = _cached_film_map()
    with client() as c:
        rows = _query_rows(
            c,
            f"SELECT film_id, title, toString(release_date), popularity, language "
            f"FROM films WHERE film_id = {int(film_id)} LIMIT 1",
        )
        if not rows:
            return None
        row = rows[0]

        signals: dict[str, int] = {}
        for family, table, where in (
            ("box_office", "box_office_revenue",      f"film_id = {int(film_id)} AND date >= today() - 7"),
            ("social",     "social_trends",           f"film_id = {int(film_id)} AND ts   >= now() - INTERVAL 7 DAY"),
            ("reviews",    "review_scores",           f"film_id = {int(film_id)} AND ts   >= now() - INTERVAL 7 DAY"),
            ("streaming",  "streaming_watch_minutes", f"film_id = {int(film_id)} AND ts   >= now() - INTERVAL 7 DAY"),
        ):
            r = _query_rows(c, f"SELECT count() FROM {table} WHERE {where}")
            signals[family] = int(r[0][0]) if r else 0

    return {
        "id": int(row[0]),
        "title": row[1] or "",
        "poster_url": "",
        "release_date": row[2] if row[2] is not None else "",
        "popularity": float(row[3]) if row[3] is not None else 0.0,
        "language": row[4] if len(row) > 4 and row[4] is not None else "",
        "signals": signals,
        "featured": film_id in cached_map,
        "cached_scenario_id": cached_map.get(film_id),
    }


def search_films(q: str, limit: int = 20) -> list[dict[str, Any]]:
    if not q:
        return []
    safe = q.replace("'", "''")
    with client() as c:
        rows = _query_rows(
            c,
            f"SELECT film_id, title FROM films "
            f"WHERE positionCaseInsensitive(title, '{safe}') > 0 "
            f"ORDER BY popularity DESC LIMIT {int(limit)}"
        )
    return [{"id": int(r[0]), "title": r[1] or "", "poster_url": ""} for r in rows]
