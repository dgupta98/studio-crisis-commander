"""Background task that keeps ClickHouse Cloud from auto-suspending.

ClickHouse Cloud parks the compute pool after a period of inactivity
(default ~15 min on the Development tier). The first query after that
pays a 5-30s wake-up cost, which shows up as "loading…" on the landing
page even though Cloud Run itself is warm.

Since we keep Cloud Run at min-instances=1, this loop is always alive.
It fires a cheap `SELECT 1` every CH_WARMER_INTERVAL_SEC (default 240s
— safely under the CH Cloud idle threshold). Failures are logged and
swallowed so a transient blip never crashes the API process.

Set CH_WARMER_INTERVAL_SEC=0 to disable (useful for local dev where
you don't want a rogue query firing every few minutes).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

_task: Optional[asyncio.Task[None]] = None

_DEFAULT_INTERVAL_SEC = 240


def _interval_sec() -> int:
    raw = os.environ.get("CH_WARMER_INTERVAL_SEC", str(_DEFAULT_INTERVAL_SEC))
    try:
        v = int(raw)
    except ValueError:
        return _DEFAULT_INTERVAL_SEC
    if v <= 0:
        return 0
    # Floor at 30s so a fat-fingered env var can't hammer CH.
    return max(30, v)


async def _warm_once() -> None:
    from data.ch_client import client

    def _do() -> None:
        with client() as c:
            c.query("SELECT 1")

    await asyncio.to_thread(_do)


async def _loop(interval: int) -> None:
    log.info("ch-warmer: starting, interval=%ss", interval)
    while True:
        try:
            await _warm_once()
            log.debug("ch-warmer: ping ok")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — log-and-continue by design
            log.warning("ch-warmer: ping failed: %s", exc)
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise


def start() -> None:
    """Start the warmer if it isn't already running. Idempotent."""
    global _task
    interval = _interval_sec()
    if interval == 0:
        log.info("ch-warmer: disabled (CH_WARMER_INTERVAL_SEC=0)")
        return
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop(interval), name="ch-warmer")


async def stop() -> None:
    """Cancel the warmer and wait for it to unwind. Idempotent."""
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None
