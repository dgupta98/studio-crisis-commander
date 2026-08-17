"""GET /intake/rates SSE contract test.

Uses `?limit=1` so the async generator terminates after emitting one payload —
required because httpx's ASGITransport (both the sync TestClient path via
starlette.testclient._TestClientTransport.handle_request, which does
`portal.call(self.app, scope, receive, send)`, and the async
AsyncClient(ASGITransport(...)) path in httpx._transports.asgi.handle_async_request,
which does `await self.app(scope, receive, send)`) fully awaits the ASGI app
before returning any Response object. Against an unbounded SSE loop that never
returns, `client.stream(...)` hangs forever. `?limit=N` is a test seam declared
in the router; production callers omit it.
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient
from unittest.mock import patch


def test_intake_rates_endpoint_exists():
    from api.tests.test_fallback import _mk_triple
    with patch("api.main.load_cached_triple", return_value=_mk_triple()):
        from api.main import app
        with TestClient(app) as client:
            with client.stream("GET", "/intake/rates?limit=1") as r:
                assert r.status_code == 200
                assert r.headers["content-type"].startswith("text/event-stream")


def test_intake_rates_first_payload_has_four_families(monkeypatch):
    # Patch _rates_sync so we don't hit ClickHouse.
    from api.routers import intake
    monkeypatch.setattr(intake, "_rates_sync",
                        lambda: {"box_office": 10, "social": 20, "reviews": 30, "streaming": 40})

    from api.tests.test_fallback import _mk_triple
    with patch("api.main.load_cached_triple", return_value=_mk_triple()):
        from api.main import app
        with TestClient(app) as client:
            with client.stream("GET", "/intake/rates?limit=1") as r:
                lines: list[str] = []
                for line in r.iter_lines():
                    lines.append(line)
                    if len(lines) >= 2:  # one data line + one blank line = one event
                        break
                data_lines = [l for l in lines if l.startswith("data: ")]
                assert data_lines, f"no data: line, got {lines!r}"
                payload = json.loads(data_lines[0][len("data: "):])
                assert set(payload.keys()) == {"box_office", "social", "reviews", "streaming"}
                assert payload["box_office"] == 10
