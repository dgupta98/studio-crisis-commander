"""App boots + healthcheck endpoint returns OK + runtime is installed."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def test_healthcheck(tmp_path, monkeypatch):
    # Bypass the cached-triple load-on-startup for unit tests.
    from api.tests.test_fallback import _mk_triple

    def _fake_loader(path=None):
        return _mk_triple()

    with patch("api.main.load_cached_triple", side_effect=_fake_loader):
        from api.main import app
        with TestClient(app) as client:
            r = client.get("/healthz")
            assert r.status_code == 200
            assert r.json() == {"status": "ok"}
