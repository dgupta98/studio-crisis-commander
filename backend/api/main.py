"""FastAPI app entrypoint.

Startup:
  1. Load cached fallback triple (fail loud if missing).
  2. Instantiate PipelineRuntime.
  3. install_cached_triple(...) so api.pipeline can swap on exception.
  4. Mount routers.

The app object is imported by uvicorn: `uvicorn api.main:app`.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.fallback import load_cached_triple
from api.pipeline import install_cached_triple
from api.runtime import PipelineRuntime


runtime: PipelineRuntime = PipelineRuntime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    triple = load_cached_triple()
    install_cached_triple(triple)
    app.state.runtime = runtime
    app.state.cached_triple = triple
    yield


app = FastAPI(title="Studio Crisis Commander API", lifespan=lifespan)

_origins = os.getenv("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
