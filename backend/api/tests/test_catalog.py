"""Catalog endpoint shape tests — mocks ClickHouse so tests are hermetic."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient


def _fake_ch_factory(rows_by_pattern: dict[str, list]):
    """Return a fake CH client that returns per-query rows based on SQL substrings."""
    def _fake():
        class FakeCH:
            def query(self, sql):
                m = MagicMock()
                m.result_rows = []
                for pattern, rows in rows_by_pattern.items():
                    if pattern in sql:
                        m.result_rows = rows
                        break
                return m
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return FakeCH()
    return _fake


def test_catalog_shelves_shape(monkeypatch):
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({
        # More specific patterns must come FIRST — the fake iterates in insertion
        # order and breaks on the first substring hit. `_tmdb_ids_for` batches
        # `SELECT film_id, tmdb_id FROM films WHERE film_id IN (...)`; without
        # this entry the broader "FROM films" match returns the shelves row
        # shape and `int('Alpha')` blows up parsing the "tmdb_id" column.
        "tmdb_id FROM films WHERE film_id IN": [(1, 100)],
        # `IN (...)` featured lookup + `ORDER BY release_date` full-catalog
        # query both start `... FROM films`. Two-col rows are fine — _to_card
        # handles missing tail elements.
        "FROM films":                    [(1, "Alpha", 0.0, "")],
        # trending_region uses `FROM films f JOIN box_office_revenue b`
        "FROM films f JOIN box_office_revenue": [(1, "Alpha", 200.0, "US")],
        # streaming climbers
        "FROM streaming_watch_minutes st JOIN films f": [(1, "Alpha", 999.0, "US")],
    })
    # Decouple from real data/eval_cache/*.json so the featured shelf is
    # populated regardless of CI filesystem contents.
    monkeypatch.setattr(
        "api.catalog.shelves._cached_film_map",
        lambda: {1: "sc_001"},
    )
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/shelves?region=US")
            assert r.status_code == 200
            body = r.json()
            ids = [s["id"] for s in body]
            # region provided → trending_region present; remaining shelves in order
            assert ids == ["featured", "trending_region", "streaming", "all"]
            for shelf in body:
                assert isinstance(shelf["films"], list) and shelf["films"], \
                    f"shelf {shelf['id']} unexpectedly empty"
                card = shelf["films"][0]
                assert set(card.keys()) >= {"id", "title", "poster_url"}


def test_catalog_film_detail_shape(monkeypatch):
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({
        "FROM films WHERE film_id": [(1, "Alpha", "2024-01-01", 50.0, "en")],
        "SELECT count() FROM": [(7,)],  # every signals count returns 7
    })
    monkeypatch.setattr(
        "api.catalog.shelves._cached_film_map",
        lambda: {1: "sc_001"},
    )
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/films/1")
            assert r.status_code == 200
            body = r.json()
            for key in ("id", "title", "poster_url", "release_date",
                        "signals", "featured", "cached_scenario_id"):
                assert key in body, f"missing {key}"
            assert body["signals"].keys() == {"box_office", "social", "reviews", "streaming"}


def test_catalog_film_detail_missing(monkeypatch):
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({"FROM films WHERE film_id": []})
    monkeypatch.setattr("api.catalog.shelves._cached_film_map", lambda: {})
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/films/9999999")
            assert r.status_code == 404


def test_catalog_search():
    from api.tests.test_fallback import _mk_triple
    fake = _fake_ch_factory({
        # search_films now returns `SELECT film_id, title, tmdb_id` — the third
        # column is fed to _POSTER_BY_TMDB. Return 0 (unknown poster) so the
        # search result renders with an empty poster_url instead of blowing up
        # on an index error.
        "positionCaseInsensitive": [(1, "Alpha", 0), (2, "Alphabet", 0)],
    })
    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.catalog.shelves.client", new=fake):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/catalog/search?q=alp")
            assert r.status_code == 200
            body = r.json()
            assert isinstance(body, list)
            assert body[0]["id"] == 1 and body[0]["title"] == "Alpha"


@pytest.mark.asyncio
async def test_shelves_include_top_regions_per_film():
    from api.main import app
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://t") as ac:
        async with ac.stream("GET", "/healthz"):
            pass
        r = await ac.get("/catalog/shelves")
        assert r.status_code == 200
        shelves = r.json()
        # At least one shelf with at least one film.
        assert shelves, "no shelves returned"
        for shelf in shelves:
            for film in shelf["films"]:
                assert "top_regions" in film, f"film {film['id']} missing top_regions"
                assert isinstance(film["top_regions"], list)
                assert len(film["top_regions"]) <= 6
                for entry in film["top_regions"]:
                    assert "code" in entry
                    assert "delta_pct" in entry
                    assert isinstance(entry["delta_pct"], (int, float))


@pytest.mark.asyncio
async def test_latest_investigation_accepts_region_filter():
    from api.main import app
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://t") as ac:
        async with ac.stream("GET", "/healthz"):
            pass
        # Without region: should not error even if no data.
        r = await ac.get("/catalog/films/1/latest-investigation")
        assert r.status_code == 200
        # With region: should not error either; result may be null.
        r2 = await ac.get("/catalog/films/1/latest-investigation?region=Brazil")
        assert r2.status_code == 200
        body = r2.json()
        if body is not None:
            assert body["detection"]["region"] == "Brazil"
