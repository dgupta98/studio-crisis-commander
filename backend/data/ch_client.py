"""Thin clickhouse-connect wrapper for Layer 1 data seeding.

BOUNDARY RULE (rules-critical):
    This module wraps clickhouse-connect for direct ClickHouse access.
    It is used ONLY by:
      - backend/data/*.py    (Layer 1 data generation)
      - backend/data/mv/*    (Layer 2 materialized-view setup, future)
    It must NEVER be imported from backend/agents/ or backend/mcp/.
    Agents reach ClickHouse through mcp-clickhouse — that path is what
    the ClickHouse-track judges verify.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import clickhouse_connect
from clickhouse_connect.driver import Client
from dotenv import load_dotenv

load_dotenv()


def _require(var: str) -> str:
    val = os.environ.get(var)
    if not val:
        raise RuntimeError(
            f"Missing required env var: {var}. Set it in .env "
            "(see .env.example)."
        )
    return val


def get_client() -> Client:
    """Return a new ClickHouse client from env vars.

    Env: CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
         CLICKHOUSE_PASSWORD, CLICKHOUSE_DB.
    """
    return clickhouse_connect.get_client(
        host=_require("CLICKHOUSE_HOST"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8443")),
        username=_require("CLICKHOUSE_USER"),
        password=_require("CLICKHOUSE_PASSWORD"),
        database=_require("CLICKHOUSE_DB"),
        secure=True,
    )


@contextmanager
def client() -> Iterator[Client]:
    c = get_client()
    try:
        yield c
    finally:
        c.close()


def insert_batches(
    table: str,
    rows: Sequence[Sequence[Any]],
    column_names: Sequence[str],
    batch_size: int = 100_000,
) -> int:
    """Insert rows into `table` in fixed-size batches. Returns total inserted.

    `rows` must be materialized (Sequence, not a generator) — needs len/slicing.
    Default batch_size sized for ClickHouse Cloud Mini (12GB); Task 4/9 may
    tune upward once memory headroom is measured.
    """
    if not rows:
        return 0
    total = 0
    with client() as c:
        for start in range(0, len(rows), batch_size):
            chunk = rows[start : start + batch_size]
            c.insert(table, chunk, column_names=list(column_names))
            total += len(chunk)
    return total


def verify() -> None:
    """Smoke test: connects and prints server version + current db."""
    with client() as c:
        version = c.query("SELECT version()").result_rows[0][0]
        db = c.query("SELECT currentDatabase()").result_rows[0][0]
        print(f"ClickHouse OK: version={version} database={db}")


if __name__ == "__main__":
    verify()
