"""GET /stats/summary shape test — mocks ClickHouse so it's hermetic."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def test_stats_summary_shape():
    from api.tests.test_fallback import _mk_triple

    class FakeCH:
        def query(self, sql):
            m = MagicMock()
            # Return a plausible scalar for every query — the actual value
            # doesn't matter for the shape assertion, only that _scalar()
            # picks up rows[0][0].
            m.result_rows = [[42]]
            return m
        def __enter__(self): return self
        def __exit__(self, *a): return False

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.stats.client", return_value=FakeCH()):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/stats/summary")
            assert r.status_code == 200
            body = r.json()
            for key in ("films_tracked", "regions", "days_history",
                        "rows_scanned_24h", "p50_detection_ms"):
                assert key in body, f"missing {key}"
            # films_tracked comes straight from FakeCH's [[42]]
            assert body["films_tracked"] == 42
            # rows_scanned_24h sums 4 tables × 42 each
            assert body["rows_scanned_24h"] == 42 * 4
