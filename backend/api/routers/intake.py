"""SSE stream of rolling per-family ingest rates for the landing/dashboard IntakeStrip.

Emits one JSON object every 2s with row-counts inserted in the past minute per signal
family. Wire format is one `data:` line per event (matches SseEvent conventions).

The `?limit=N` query param bounds the stream to N events and then closes; this is
strictly a test seam because httpx's ASGITransport (used by TestClient and by
AsyncClient(ASGITransport(...))) buffers the entire response until the ASGI app
completes — it cannot iterate chunks from an unbounded generator. In production
the frontend hits this endpoint without ?limit and receives an infinite stream.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from data.ch_client import client

router = APIRouter(prefix="/intake", tags=["intake"])

# Signal family → the canonical numeric-ingest table for that family.
# Names match backend/data/schema.sql — do NOT invent table names.
_FAMILIES = {
    "box_office": "box_office_revenue",
    "social":     "social_trends",
    "reviews":    "review_scores",
    "streaming":  "streaming_watch_minutes",
}


def _rates_sync() -> dict[str, int]:
    out: dict[str, int] = {}
    with client() as c:
        for family, table in _FAMILIES.items():
            try:
                rows = c.query(
                    f"SELECT count() FROM {table} "
                    f"WHERE metric_ts >= now() - INTERVAL 1 MINUTE"
                ).result_rows
                out[family] = int(rows[0][0]) if rows else 0
            except Exception:
                out[family] = 0
    return out


async def _event_stream(limit: int | None = None) -> AsyncIterator[bytes]:
    emitted = 0
    while True:
        rates = await asyncio.to_thread(_rates_sync)
        yield f"data: {json.dumps(rates)}\n\n".encode()
        emitted += 1
        if limit is not None and emitted >= limit:
            return
        await asyncio.sleep(2.0)


@router.get("/rates")
async def intake_rates(limit: int | None = None) -> StreamingResponse:
    return StreamingResponse(_event_stream(limit=limit),
                             media_type="text/event-stream")
