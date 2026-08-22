"""Catalog endpoint shape tests — mocks ClickHouse so tests are hermetic."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


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
        "positionCaseInsensitive": [(1, "Alpha"), (2, "Alphabet")],
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
