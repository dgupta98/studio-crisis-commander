"""MCPToolset factory wired to mcp-clickhouse via stdio subprocess.

`build_toolset()` returns a fresh MCPToolset per call. The caller owns
the toolset's lifecycle (ADK closes it on Runner shutdown).

This module is the ONLY place agent code touches process spawn / env
plumbing for ClickHouse. No agent may import `data.ch_client` or
`clickhouse_connect` directly — enforced by acceptance §1.
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv
from google.adk.tools.mcp_tool.mcp_toolset import (
    MCPToolset,
    StdioConnectionParams,
    StdioServerParameters,
)

# Load .env once at module import — matches Layer 1/2 pattern.
load_dotenv()

# Layer 1 env var names → mcp-clickhouse env var names.
# mcp-clickhouse expects CLICKHOUSE_DATABASE; our .env uses CLICKHOUSE_DB.
_ENV_MAP = {
    "CLICKHOUSE_HOST": "CLICKHOUSE_HOST",
    "CLICKHOUSE_PORT": "CLICKHOUSE_PORT",
    "CLICKHOUSE_USER": "CLICKHOUSE_USER",
    "CLICKHOUSE_PASSWORD": "CLICKHOUSE_PASSWORD",
    "CLICKHOUSE_DB": "CLICKHOUSE_DATABASE",
}
_REQUIRED = ("CLICKHOUSE_HOST", "CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD")


def _env_for_subprocess() -> dict[str, str]:
    """Build the env dict passed to the mcp-clickhouse subprocess.

    Copies relevant CH vars from os.environ, remapping CLICKHOUSE_DB ->
    CLICKHOUSE_DATABASE. Does NOT mutate os.environ.
    """
    for var in _REQUIRED:
        if not os.environ.get(var):
            raise RuntimeError(
                f"{var} not set in environment — check backend/.env"
            )
    env: dict[str, str] = {}
    for src, dst in _ENV_MAP.items():
        val = os.environ.get(src)
        if val is not None:
            env[dst] = val
    # Force secure TLS mode (matches ClickHouse Cloud default; port 8443).
    env.setdefault("CLICKHOUSE_SECURE", "true")
    return env


def build_toolset() -> MCPToolset:
    """Fresh MCPToolset that spawns `python -m mcp_clickhouse.main` as a
    stdio subprocess. One subprocess per toolset; ADK closes it on shutdown.
    """
    params = StdioConnectionParams(
        server_params=StdioServerParameters(
            command=sys.executable,
            args=["-m", "mcp_clickhouse.main"],
            env=_env_for_subprocess(),
        ),
        timeout=15.0,   # subprocess startup + initial handshake budget
    )
    return MCPToolset(connection_params=params)
