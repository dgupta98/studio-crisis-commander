# API Layer (Layer 4)

FastAPI + SSE for the Studio Crisis Commander dashboard. Wraps the four
existing pipeline stages (Detection → Investigation → Decision → Report)
in one background task per run, streams the live agent trace over
Server-Sent Events, and serves the read/approval endpoints the frontend
consumes.

## Boundaries

- May import `data.ch_client` directly.
- May call the public entrypoints of `agents.investigation`,
  `agents.decision`, `agents.report`, and the `agents.decision.audit`
  facade (`list_recent_audit`, `get_audit`, `async_get_audit`,
  `async_approve_decision`, `deny_decision`, `AuditRow`).
- MUST NOT import any `_provenance`, `subagents`, `prompts`, `actions`,
  or private audit functions. Enforced by §1 grep in
  `api/tests/acceptance.py`.

## Layout

| File | Role |
| --- | --- |
| `main.py` | FastAPI app, lifespan (load cached triple), CORS, router mounts, `/healthz`. |
| `runtime.py` | `PipelineRuntime`: run registry, replay buffer, subscriber fan-out, TTL, decision→run index. |
| `pipeline.py` | `run_pipeline(...)` — the background coroutine; live path + fallback swap on exception. |
| `events.py` | `SseEvent` dataclass + SSE wire serializer. |
| `fallback.py` | Cached-triple loader + paced replayer. |
| `detection_source.py` | Post-inject DetectionIn producer (refresh+SELECT, synth fallback). |
| `routers/inject.py` | `POST /inject-crisis`. |
| `routers/stream.py` | `GET /stream/investigation/{run_id}` (SSE). |
| `routers/detections.py` | `GET /detections`. |
| `routers/audit.py` | `GET /audit`, `POST /approve/{id}`, `POST /deny/{id}`. |
| `routers/metrics.py` | `GET /metrics/{film_id}/{region}`. |
| `cached/fallback_triple.json` | Pre-captured pipeline triple used when live fails. |
| `tests/acceptance.py` | 9-check live sweep. |
| `tests/regenerate_fallback.py` | Regenerate the cached triple (~$0.10 per run). |

## Running

Local dev:

```
cd backend
PYTHONPATH=. venv/bin/uvicorn api.main:app --reload --port 8000
```

Full acceptance sweep (live, ~$0.20):

```
PYTHONPATH=. venv/bin/python -m api.tests.acceptance
```

Regenerate cached fallback triple (only when contracts change, ~$0.10):

```
PYTHONPATH=. venv/bin/python -m api.tests.regenerate_fallback
```

## Environment

- `CORS_ORIGINS` — comma-separated list, or `*` (default). Set when the
  frontend deploys.
- All ClickHouse / Google credentials come from the existing `.env`
  used by Layers 1-3.

## Spec

`docs/superpowers/specs/2026-08-09-layer-4-orchestration-api-design.md`
