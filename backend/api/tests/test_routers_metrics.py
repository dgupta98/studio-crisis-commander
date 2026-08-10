"""GET /metrics/{film}/{region} — 4 parallel timeseries + latency badge."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


def test_metrics_returns_all_four_series():
    from api.tests.test_fallback import _mk_triple

    def _fake_client_factory():
        class FakeCH:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def query(self, sql):
                m = MagicMock()
                m.result_rows = [("2026-08-09 12:00:00", 1000, 100)]
                return m
        return FakeCH()

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.metrics.client", side_effect=_fake_client_factory):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/metrics/1/Brazil?hours=48")
            assert r.status_code == 200
            body = r.json()
            assert body["film_id"] == 1
            assert body["region"] == "Brazil"
            assert set(body["timeseries"].keys()) == {
                "box_office_daily", "social_virality_hourly",
                "sentiment_hourly", "trailer_hourly",
            }
            assert "query_latency_ms" in body
