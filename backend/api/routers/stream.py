"""GET /stream/investigation/{run_id} — SSE stream of the run's events."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse


router = APIRouter(tags=["pipeline"])


@router.get("/stream/investigation/{run_id}")
async def stream_run(run_id: str, request: Request):
    runtime = request.app.state.runtime
    if (await runtime.get(run_id)) is None:
        raise HTTPException(status_code=404, detail=f"unknown run_id: {run_id}")

    async def _gen():
        # Retry hint for browser EventSource auto-reconnect.
        yield b"retry: 3000\n\n"
        async for ev in runtime.subscribe(run_id):
            yield ev.serialize()

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
