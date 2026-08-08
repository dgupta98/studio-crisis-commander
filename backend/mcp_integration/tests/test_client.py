"""Unit tests for mcp_integration.client.build_toolset()."""

from __future__ import annotations

import os

import pytest

from mcp_integration.client import build_toolset, _env_for_subprocess


def test_env_maps_layer1_names_to_mcp_clickhouse_names(monkeypatch):
    """Layer 1 uses CLICKHOUSE_DB; mcp-clickhouse expects CLICKHOUSE_DATABASE.
    build_toolset maps CLICKHOUSE_DB -> CLICKHOUSE_DATABASE without mutating os.environ."""
    monkeypatch.setenv("CLICKHOUSE_HOST", "example.clickhouse.cloud")
    monkeypatch.setenv("CLICKHOUSE_PORT", "8443")
    monkeypatch.setenv("CLICKHOUSE_USER", "default")
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", "secret")
    monkeypatch.setenv("CLICKHOUSE_DB", "studio_ops")
    monkeypatch.delenv("CLICKHOUSE_DATABASE", raising=False)

    env = _env_for_subprocess()

    assert env["CLICKHOUSE_HOST"] == "example.clickhouse.cloud"
    assert env["CLICKHOUSE_PORT"] == "8443"
    assert env["CLICKHOUSE_USER"] == "default"
    assert env["CLICKHOUSE_PASSWORD"] == "secret"
    assert env["CLICKHOUSE_DATABASE"] == "studio_ops"
    assert "CLICKHOUSE_DB" not in env  # remapped, not both
    assert "CLICKHOUSE_DATABASE" not in os.environ  # never mutates parent env


def test_env_requires_host():
    """Missing CLICKHOUSE_HOST is a fail-fast setup error."""
    # Clear the four required vars for this test
    saved = {k: os.environ.pop(k, None) for k in ("CLICKHOUSE_HOST",)}
    try:
        with pytest.raises(RuntimeError, match="CLICKHOUSE_HOST"):
            _env_for_subprocess()
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


@pytest.mark.skipif("CLICKHOUSE_HOST" not in os.environ,
                    reason="requires .env with CH creds")
def test_build_toolset_returns_mcp_toolset():
    """build_toolset() returns a working MCPToolset instance."""
    from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
    ts = build_toolset()
    assert isinstance(ts, MCPToolset)
