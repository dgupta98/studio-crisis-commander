"""GET /metrics/{film}/{region} — 4 parallel timeseries + latency badge."""
from __future__ import annotations

import re
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi.testclient import TestClient

from api.routers.metrics import (
    _q_box_office, _q_social, _q_sentiment, _q_trailer,
)


def test_ts_alias_does_not_shadow_column():
    """New ClickHouse analyzer resolves `WHERE ts >= ...` against the SELECT
    alias when the alias name equals the column name, comparing String to
    DateTime and raising NO_COMMON_TYPE (code 386). Guard by asserting no
    query aliases toString(ts|date) back to `ts` — must use a distinct name."""
    queries = [
        _q_box_office(1, "NA", 48),
        _q_social(1, "NA", 48),
        _q_sentiment(1, "NA", 48),
        _q_trailer(1, "NA", 48),
    ]
    for q in queries:
        assert not re.search(r"toString\((ts|date)\)\s+AS\s+ts\b", q), q


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


@pytest.mark.asyncio
async def test_metrics_regions_returns_15_canonical():
    from api.main import app
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://t") as ac:
        async with ac.stream("GET", "/healthz"):
            pass
        r = await ac.get("/metrics/1/regions")
        assert r.status_code == 200
        body = r.json()
        assert body["film_id"] == 1
        assert isinstance(body["regions"], list)
        assert len(body["regions"]) == 15
        codes = {row["code"] for row in body["regions"]}
        assert codes == {
            "NA", "LATAM", "UK", "EU-West", "EU-East", "Nordics",
            "India", "SEA", "Korea", "Japan", "China", "MENA",
            "Africa", "ANZ", "Brazil",
        }
        first = body["regions"][0]
        assert set(first["signals"].keys()) == {
            "box_office", "social", "reviews", "streaming"
        }
        assert set(first["signals"]["box_office"].keys()) == {
            "volume", "delta_pct", "anomaly"
        }
        assert "open_investigation" in first
        assert "query_latency_ms" in body
