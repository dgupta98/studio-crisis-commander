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
from api.routers import audit as audit_router
from api.routers import catalog as catalog_router
from api.routers import detections as detections_router
from api.routers import inject as inject_router
from api.routers import intake as intake_router
from api.routers import metrics as metrics_router
from api.routers import stats as stats_router
from api.routers import stream as stream_router
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
# Bind the runtime at module scope so ASGI clients that don't fire lifespan
# (e.g. httpx ASGITransport in unit tests) still see app.state.runtime. The
# lifespan handler re-binds the same instance, plus installs the triple.
app.state.runtime = runtime

_origins = os.getenv("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _origins == "*" else [o.strip() for o in _origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(inject_router.router)
app.include_router(stream_router.router)
app.include_router(detections_router.router)
app.include_router(audit_router.router)
app.include_router(metrics_router.router)
app.include_router(stats_router.router)
app.include_router(intake_router.router)
app.include_router(catalog_router.router)


@app.get("/health")
@app.get("/healthz")
def health():
    """Trivial liveness endpoint. Two paths, one handler:
    /healthz preserves the L4 acceptance script; /health is what
    Cloud Scheduler warms and what deploy scripts curl for readiness."""
    return {"status": "ok"}
