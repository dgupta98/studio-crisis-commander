"""SSE stream of rolling per-family ingest rates for the landing/dashboard IntakeStrip.

Emits one JSON object every _POLL_INTERVAL_S with row-counts inserted in a recent
window per signal family. Wire format is one `data:` line per event (matches
SseEvent conventions).

`?limit=N` is a hidden test seam (`include_in_schema=False`, bounded 1..100)
because httpx's ASGITransport buffers the entire response until the ASGI app
completes, so an unbounded `while True` generator hangs `TestClient.stream(...)`.
Production frontends omit it and receive the infinite stream.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from data.ch_client import client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/intake", tags=["intake"])

_POLL_INTERVAL_S = 2.0

# Signal family → (table, time-column, unit). box_office uses `date` (Date,
# daily grain), the rest use `ts` (DateTime). We anchor the window on the
# table's max(ts|date) rather than now(), so the strip shows a meaningful
# non-zero rate whether the synthetic feed is actively producing or the demo
# is replaying older data. The original now()-based window returned 0
# whenever the data was stale.
_FAMILIES: dict[str, tuple[str, str]] = {
    "box_office": ("box_office_revenue",      "date"),
    "social":     ("social_trends",           "ts"),
    "reviews":    ("review_scores",           "ts"),
    "streaming":  ("streaming_watch_minutes", "ts"),
}


def _rates_sync() -> dict[str, int]:
    # One ClickHouse client scope for all 4 queries — opening the HTTPS client
    # per-family would triple the poll cost. If the client itself fails to open
    # (missing env), let it propagate to a 500 rather than emit `{0,0,0,0}`
    # forever, which would silently mask configuration drift.
    #
    # We report a *per-minute* rate averaged over the last DAY_WINDOW days of
    # available data. A 1-minute window was too narrow for the synthetic feed
    # (returned 0 or 1); box_office's old `count()/1440` also truncated to 0
    # for anything under a full day of rows. Averaging over a wider window
    # gives a stable, meaningful number that matches user intuition ("how
    # busy is this pipeline").
    out: dict[str, int] = {}
    day_window = 7
    minutes = day_window * 24 * 60
    with client() as c:
        for family, (table, col) in _FAMILIES.items():
            try:
                sql = (
                    f"SELECT toUInt64(count() / {minutes}) FROM {table} "
                    f"WHERE {col} >= (SELECT max({col}) - INTERVAL {day_window} DAY FROM {table})"
                )
                rows = c.query(sql).result_rows
                out[family] = int(rows[0][0]) if rows and rows[0][0] is not None else 0
            except Exception:  # noqa: BLE001 — schema drift / partition eviction / etc.
                log.warning("intake rates query failed for %s", family, exc_info=True)
                out[family] = 0
    return out


async def _event_stream(limit: int | None = None) -> AsyncIterator[bytes]:
    # `asyncio.sleep(…)` is a cancellation point, so a client disconnect
    # cleanly cancels this generator via Starlette's StreamingResponse.
    emitted = 0
    while True:
        rates = await asyncio.to_thread(_rates_sync)
        yield f"data: {json.dumps(rates)}\n\n".encode()
        emitted += 1
        if limit is not None and emitted >= limit:
            return
        await asyncio.sleep(_POLL_INTERVAL_S)


@router.get("/rates")
async def intake_rates(
    limit: int | None = Query(None, ge=1, le=100, include_in_schema=False),
) -> StreamingResponse:
    return StreamingResponse(_event_stream(limit=limit),
                             media_type="text/event-stream")
