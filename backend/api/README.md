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

## Ops notes (Cloud Run)

- **Sizing:** 2 GiB / 2 vCPU / concurrency 4. A single live run loads two ADK
  LlmAgents + the Gemini SDK + the mcp-clickhouse subprocess and peaks at
  ~1.05 GiB. The 1 GiB default OOM-kills mid-run; because
  `PipelineRuntime` is in-process, the browser then reconnects into a fresh
  container and hits 404 on `/stream/investigation/{run_id}`.
- **SSE wire format:** `events.py::SseEvent.serialize()` emits only
  `data: <json>\n\n` — no `event: <type>` line. Named SSE events only
  dispatch through `addEventListener('<type>', ...)`, not `onmessage`;
  the client uses `onmessage` and routes on the `type` field inside the
  JSON body.
- **SSE graceful close:** the frontend (`frontend/src/api/sse.ts`) closes
  its `EventSource` on `pipeline.completed` / `pipeline.failed` so the
  native auto-reconnect doesn't fire `onerror` after a normal end-of-stream.
- **Metrics query aliasing:** `routers/metrics.py` aliases `toString(ts)`
  as `ts_str` (not `ts`) — the ClickHouse new analyzer resolves
  `WHERE ts >= now() - INTERVAL H HOUR` against the SELECT alias, and
  aliasing to `ts` yields `String >= DateTime` (NO_COMMON_TYPE, code 386).
- **Decision subject clamp:** `agents/decision/agent.py::_clamp_subject_params`
  overwrites `film_id`/`region` in each action's params with the detection
  subject before rendering impact SQL. LLM prompt Rule 2 asks for the same,
  but Flash periodically emits a different film — the clamp makes it
  deterministic and prevents `impact_usd = 0` (no matching rows) and
  hallucinated films in the Report narrative.

## Spec

`docs/superpowers/specs/2026-08-09-layer-4-orchestration-api-design.md`
