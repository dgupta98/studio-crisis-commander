"""POST /inject-crisis — kick off one or more pipeline runs."""
from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from api.pipeline import run_pipeline


router = APIRouter(tags=["pipeline"])


# Cap fan-out to the canonical 15 regions so a bad client can't spawn hundreds
# of concurrent pipelines. Matches the frontend's canonical region list.
_MAX_REGIONS = 15


class InjectRequest(BaseModel):
    ctype: str | None = None
    film_id: int | None = None
    region: str | None = None
    regions: list[str] | None = None
    magnitude: float | None = None
    fallback: str | None = Field(default=None,
                                 description='"auto" (default) or "force"')

    @field_validator("regions")
    @classmethod
    def _cap_regions(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > _MAX_REGIONS:
            raise ValueError(f"at most {_MAX_REGIONS} regions per inject")
        return v


async def _kickoff(runtime, request_body: dict, force_fallback: bool) -> str:
    run_id = uuid4().hex
    await runtime.register(run_id)
    asyncio.create_task(run_pipeline(
        runtime, run_id,
        request=request_body,
        force_fallback=force_fallback,
    ))
    return run_id


@router.post("/inject-crisis", status_code=202)
async def inject_crisis(req: InjectRequest, request: Request):
    runtime = request.app.state.runtime
    force = (req.fallback == "force")
    # Multi-region path: fan out to N runs, one per region, with the same
    # crisis config. Returns run_ids[] so the frontend can open N SSE streams.
    if req.regions:
        run_ids = await asyncio.gather(*[
            _kickoff(runtime,
                     {"ctype": req.ctype, "film_id": req.film_id,
                      "region": r, "magnitude": req.magnitude},
                     force)
            for r in req.regions
        ])
        return JSONResponse(
            status_code=202,
            content={
                "run_ids": list(run_ids),
                "stream_urls": [f"/stream/investigation/{rid}" for rid in run_ids],
            },
        )
    # Single-region path: unchanged shape for backward compat.
    run_id = await _kickoff(
        runtime,
        {"ctype": req.ctype, "film_id": req.film_id,
         "region": req.region, "magnitude": req.magnitude},
        force,
    )
    return JSONResponse(
        status_code=202,
        content={
            "run_id": run_id,
            "stream_url": f"/stream/investigation/{run_id}",
        },
    )
