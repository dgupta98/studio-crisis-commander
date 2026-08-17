"""GET /detections shape test with mocked ClickHouse client."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def test_detections_returns_shape(monkeypatch):
    from api.tests.test_fallback import _mk_triple
    fake_rows = [
        ("2026-08-09 12:00:00", "x.y", 1, "Brazil",
         "zscore", 0.0, 1.0, 5.0, 1000.0, 5.0, "k1", "", 4321),
    ]

    class FakeCH:
        def query(self, sql):
            m = MagicMock()
            m.result_rows = fake_rows
            return m
        def __enter__(self): return self
        def __exit__(self, *a): return False

    with patch("api.main.load_cached_triple", return_value=_mk_triple()), \
         patch("api.routers.detections.client", return_value=FakeCH()):
        from api.main import app
        with TestClient(app) as tc:
            r = tc.get("/detections?limit=5&since_hours=24")
            assert r.status_code == 200
            body = r.json()
            assert "detections" in body
            assert "query_latency_ms" in body
            row = body["detections"][0]
            assert row["metric"] == "x.y"
            assert row["film_title"] == ""
            assert row["latency_ms"] == 4321
