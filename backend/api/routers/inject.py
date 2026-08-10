"""POST /inject-crisis — kick off a new pipeline run."""
from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from api.pipeline import run_pipeline


router = APIRouter(tags=["pipeline"])


class InjectRequest(BaseModel):
    ctype: str | None = None
    film_id: int | None = None
    region: str | None = None
    magnitude: float | None = None
    fallback: str | None = Field(default=None,
                                 description='"auto" (default) or "force"')


@router.post("/inject-crisis", status_code=202)
async def inject_crisis(req: InjectRequest, request: Request):
    runtime = request.app.state.runtime
    run_id = uuid4().hex
    await runtime.register(run_id)
    asyncio.create_task(run_pipeline(
        runtime, run_id,
        request={"ctype": req.ctype, "film_id": req.film_id,
                 "region": req.region, "magnitude": req.magnitude},
        force_fallback=(req.fallback == "force"),
    ))
    return JSONResponse(
        status_code=202,
        content={
            "run_id": run_id,
            "stream_url": f"/stream/investigation/{run_id}",
        },
    )
