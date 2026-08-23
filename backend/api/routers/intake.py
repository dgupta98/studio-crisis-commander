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
    # Emit rows-per-hour averaged over the last 24h of available data,
    # anchored on each table's max(ts|date) so the strip stays meaningful
    # when the synthetic feed isn't being continuously topped up.
    #
    # Prior attempts used per-minute rates over a 1-day or 7-day window.
    # Both integer-truncated to zero for box_office (~3.7K rows/day
    # against a 1440- or 10080-minute divisor) and for review_scores
    # under typical volumes. Rows-per-hour keeps the number large enough
    # that integer casting doesn't collapse it to zero, matches the
    # "signals arriving live" intuition, and is honest — the label ships
    # as "rows/hr" on the frontend.
    out: dict[str, int] = {}
    with client() as c:
        for family, (table, col) in _FAMILIES.items():
            try:
                sql = (
                    f"SELECT toUInt64(round(count() / 24)) FROM {table} "
                    f"WHERE {col} >= (SELECT max({col}) - INTERVAL 1 DAY FROM {table})"
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
