# Layer 4 — Orchestration API — Design Spec

**Date:** 2026-08-09
**Layer:** 4 (Orchestration API)
**Depends on:** Layer 1 (Data), Layer 2 (Detection), Layer 3a (Investigation), Layer 3b (Decision + Report + Audit)
**Enables:** Layer 5 (Cinematic Dashboard)

## Goal

A single FastAPI app that wires the four existing entrypoints
(`refresh_detections`, `invoke_investigation`, `invoke_decision`,
`invoke_report`) into one background pipeline, streams the live agent
trace to the browser over SSE, and serves the dashboard's read
endpoints (detections, audit, metrics, approve/deny).

## Architecture

One FastAPI process. In-memory `PipelineRuntime` owns a run registry
(`dict[run_id → RunState]`) with a per-run replay buffer + subscriber
fan-out (asyncio queues). A background `asyncio` task per run executes
the pipeline stages, emitting events through the runtime; SSE handlers
subscribe to the replay buffer + live queue and stream events to the
browser. No persistence for run state — a restart drops in-flight
investigations (matches BUILD_REPORT §5's stateless model). Audit rows
persist to ClickHouse via the existing Layer 3b `audit.py` module.

Boundary: the API layer is not an agent. It may use `data.ch_client`
directly for read endpoints (fast, low-latency). Agents keep their
existing MCP contracts. §1 boundary grep in Layer 3b's acceptance
sweep is unchanged; Layer 4 adds its own §1 grep asserting `api/` does
not import agents' *internals* beyond the public `invoke_*` fns and
audit facade.

## File Layout

```
backend/api/
  __init__.py
  main.py                # FastAPI app, CORS, startup/shutdown, mounts routers
  runtime.py             # PipelineRuntime: run registry, replay buffer, fan-out, TTL
  pipeline.py            # run_pipeline(run_id, request, force_fallback) — background coro
  events.py              # SseEvent dataclass + serializer (SSE wire format)
  fallback.py            # load_cached_triple(), replay_cached(), pacing table
  routers/
    inject.py            # POST /inject-crisis
    stream.py            # GET  /stream/investigation/{run_id}
    detections.py        # GET  /detections
    audit.py             # GET  /audit, POST /approve/{id}, POST /deny/{id}
    metrics.py           # GET  /metrics/{film_id}/{region}
  cached/
    fallback_triple.json # pre-generated (inv, dec, report) — committed
  tests/
    __init__.py
    test_events.py
    test_runtime.py
    test_pipeline_fallback.py
    test_routers_inject.py
    test_routers_stream.py
    test_routers_detections.py
    test_routers_audit.py
    test_routers_metrics.py
    regenerate_fallback.py    # regen script for the cached triple
    acceptance.py             # 9-check live acceptance sweep

backend/Dockerfile        # python:3.12-slim + requirements.txt + uvicorn
```

## Endpoints

### POST /inject-crisis
Body: `{ctype?, film_id?, region?, magnitude?, fallback?: "auto" | "force"}`.
Response `202 Accepted`: `{run_id, stream_url}`.
Registers a `RunState`, launches `asyncio.create_task(run_pipeline(...))`, returns
immediately.

### GET /stream/investigation/{run_id}
`text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`.
Emits `retry: 3000` up front. Subscribes to the run's fan-out queue,
replays the full event buffer first, then tails live events until the
end-of-stream sentinel. `404` if `run_id` not in registry (TTL'd or
never existed).

### GET /detections
Query: `?limit=50&since_hours=24`.
Response: `{detections: [...], query_latency_ms}`. One
`SELECT ... FROM detections WHERE metric_ts >= now() - INTERVAL {h} HOUR
ORDER BY severity DESC LIMIT {n}` via `ch_client`.

### GET /audit
Query: `?limit=50`. Thin wrapper over `list_recent_audit(limit)` from
`agents.decision.audit`. Returns `AuditRow[]` (already Pydantic).

### POST /approve/{decision_id}
Body: `{approver: str, note?: str}`. Calls `async_approve_decision`.
Best-effort emits an `approval.granted` event on any still-live SSE
stream for the run that produced this `decision_id` (via reverse
lookup `decision_id → run_id` maintained by the runtime).

### POST /deny/{decision_id}
Same shape as `/approve`. Calls `deny_decision`. Best-effort emits
`approval.denied` event.

### GET /metrics/{film_id}/{region}
Query: `?hours=48`. Four parallel `SELECT`s (via
`asyncio.gather(asyncio.to_thread(...))`) against the rollup tables:
`box_office_hourly`, `social_virality_hourly`, `sentiment_hourly`,
`trailer_hourly`. Response bundles all four series + `query_latency_ms`.

## Run Lifecycle & SSE

### RunState

```python
@dataclass
class RunState:
    run_id: str
    created_at: float                    # time.monotonic() for TTL
    mode: Literal["live", "fallback"]
    status: Literal["running", "completed", "failed"]
    decision_id: str | None = None       # populated when decision stage completes
    events: list[SseEvent]               # replay buffer, append-only
    subscribers: list[asyncio.Queue]     # None sentinel = end-of-stream
```

Access to `runs` and `RunState` fields is protected by a single
`asyncio.Lock` on `PipelineRuntime`. TTL: evict runs older than 15 min
or older than the 50 newest, whichever is stricter, on every `emit()`.

### Event Taxonomy

Wire format: SSE `event: <type>\ndata: <json>\n\n`.
Every event body: `{seq: int, ts: iso8601, type: str, data: dict}`.

| Event | Payload | Emitted per run |
|---|---|---|
| `pipeline.started` | `{run_id, mode, requested}` | 1 |
| `detection.started` | `{source: "refresh"\|"fallback_synth"}` | 1 |
| `detection.completed` | `{detection: DetectionIn}` | 1 |
| `investigation.started` | `{}` | 1 |
| `signal.completed` | `{signal, sql, row_count}` | 4 |
| `investigation.completed` | `{investigation: InvestigationResult}` | 1 |
| `decision.started` | `{}` | 1 |
| `action.proposed` | `{action_type, priority}` | 1-3 |
| `action.impact_computed` | `{action_type, impact_usd, impact_error?}` | 1-3 |
| `decision.completed` | `{decision: DecisionResult, status, threshold_usd}` | 1 |
| `report.started` | `{}` | 1 |
| `report.completed` | `{report: ExecutiveReport}` | 1 |
| `pipeline.completed` | `{run_id, latency_ms, mode}` | 1 (terminal) |
| `pipeline.failed` | `{error, stage}` | 1 (terminal, replaces `completed`) |
| `approval.granted` | `{decision_id, approver, note}` | 0-1 (out-of-band) |
| `approval.denied` | `{decision_id, approver, note}` | 0-1 (out-of-band) |

Sub-agent events (`signal.completed`, `action.proposed`,
`action.impact_computed`) require the agents to accept an optional
keyword-only `on_event: Callable[[dict], None]` parameter. When None
(default), agents behave identically to today; when passed, they
invoke it inline at the appropriate boundaries. Backward-compatible.

## Detection Sourcing

Post-injection detection follows the C-path (agreed in Q3):

1. Call `inject_now(...)` — returns `Crisis`.
2. Call `refresh_detections(since_hours=6)` (fast, ~200-500ms).
3. `SELECT ... FROM detections WHERE dedup_key = ? OR (film_id=? AND
   region=? AND metric_ts >= ?) ORDER BY metric_ts DESC LIMIT 1` for
   up to 2s.
4. If found → build `DetectionIn` from the row, emit
   `detection.completed` with `source: "refresh"`.
5. If not found in 2s → synthesize `DetectionIn` from the `Crisis`
   object directly (mapping `crisis_type → metric`, using `magnitude`
   and `severity=magnitude` as fallback), emit with
   `source: "fallback_synth"`.

The synthesis path is inline in `pipeline.py`, not a separate module —
a dozen lines mapping `CrisisType` to canonical metric names.

## Demo-Safety Fallback

### Cached triple
`api/cached/fallback_triple.json` — a real `(DetectionIn,
InvestigationResult, DecisionResult, ExecutiveReport)` captured from a
successful pipeline run on a stable canonical crisis. Regenerated by
`api/tests/regenerate_fallback.py`. Committed to git. Loaded once at
process startup and model-validated; missing/invalid → startup fails
loud.

### Trigger
Inside `run_pipeline`:

```python
async def run_pipeline(run_id, request, *, force_fallback=False):
    try:
        if force_fallback:
            raise _ForceFallback()
        # Live path: real detection + real agents, emitting sub-agent events.
        ...
    except Exception as e:  # includes _ForceFallback, DecisionTimeout,
                            # ReportTimeout, DecisionImpactError,
                            # ReportProvenanceError; any pipeline exception
                            # falls back to cached triple
        runtime.mark_mode(run_id, "fallback")
        await replay_cached(run_id, cached, first_failed_stage=_infer_stage(e))
```

### Replay pacing
`replay_cached` emits the same event taxonomy as live, with
`asyncio.sleep()` between stages:

| Stage | Sleep |
|---|---|
| detection | 0.5s |
| investigation.started → each signal | 1.0s each |
| investigation.completed | 0.5s |
| decision.started → each action | 0.4s each |
| decision.completed | 0.3s |
| report.started → completed | 1.5s |

Total fallback runtime: ~9-10s. Every replayed event carries
`data.mode = "fallback"` for frontend badging. No new audit row is
inserted (the cached triple's `decision_id` already exists in the
audit table from generation time); `POST /approve/{decision_id}` still
works against that pre-existing row.

Partial-fallback (splicing a live inv into cached dec/report) is
explicitly **not** supported — cached artifacts are keyed to their own
investigation and don't compose cleanly.

## Cross-Cutting

- **CORS.** Wide-open in dev (`allow_origins=["*"]`); tightenable via
  `CORS_ORIGINS` env var (comma-separated) for prod.
- **Errors.** Global exception handler: unknown domain error → 500
  `{error, run_id?}`. Missing run/decision → 404. Validation → 422
  (FastAPI default).
- **Auth.** None for hackathon.
- **Logging.** Structured; one line per event emit carries
  `run_id + seq + type`.
- **Reverse lookup `decision_id → run_id`** maintained by the runtime
  as a `dict[str, str]` index, populated when `decision.completed`
  fires (which is also when `RunState.decision_id` is set). O(1)
  lookup from the approve/deny endpoints; entries evicted alongside
  their `RunState` by the same TTL policy.

## Deploy Config

- **Local dev:** `uvicorn api.main:app --reload --port 8000`.
- **Cloud Run** (judging window, deferred to Layer 6):
  `min-instances=1`, `max-instances=3`, `concurrency=8`,
  `timeout=300s` (SSE-friendly), 2 vCPU / 2 GiB.
- **Dockerfile** (ships in Layer 4): `python:3.12-slim`, install
  `requirements.txt`, `CMD ["uvicorn", "api.main:app",
  "--host=0.0.0.0", "--port=8080"]`. Cloud Run deploy script belongs
  in Layer 6.

## Testing

### Unit tests (no LLM, no ClickHouse for pure in-memory ones)

| Test | What it verifies |
|---|---|
| `test_events.py` | SSE framing, seq monotonicity, ISO8601 UTC timestamps. |
| `test_runtime.py` | Replay buffer captures every emit; late subscriber gets full replay + tails new events; multiple subscribers see identical streams; TTL evicts old runs; unregister on disconnect. |
| `test_pipeline_fallback.py` | With `runtime` real and `invoke_*` stubs raising, `run_pipeline` catches, marks mode="fallback", replays cached triple; `?fallback=force` skips live entirely. |
| `test_routers_inject.py` | POST returns 202 + valid `run_id` + `stream_url`. |
| `test_routers_stream.py` | 404 for unknown run; happy path emits the terminal `pipeline.completed` sentinel. |
| `test_routers_detections.py` | Response shape includes `query_latency_ms`, honors `limit` and `since_hours`. |
| `test_routers_audit.py` | List returns `AuditRow[]`; `/approve` calls `async_approve_decision`; `/deny` calls `deny_decision`. |
| `test_routers_metrics.py` | Response has all 4 timeseries keys; `query_latency_ms` present. |

### Live acceptance sweep (`api/tests/acceptance.py`, ~$0.20 per run)

```
§1 boundary grep: api/ may import ch_client (allowed); may NOT import agents'
                  internals beyond public invoke_* fns + audit facade
§2 startup:       app boots, fallback triple loads & model-validates
§3 inject+stream: POST /inject-crisis → collect SSE events → assert taxonomy:
                  1× detection.completed, 4× signal.completed,
                  1-3× action.impact_computed, 1× report.completed, 1× pipeline.completed
§4 audit round-trip: GET /audit shows new row; POST /approve/{id} flips status;
                     re-GET /audit shows approved
§5 fallback path: POST /inject-crisis with fallback=force → SSE tagged mode=fallback
                  throughout → completes <15s → no new audit row inserted
§6 late subscriber: POST /inject-crisis, wait 2s, THEN subscribe to /stream →
                    replay includes early events
§7 read endpoints: GET /detections (nonempty), GET /metrics/{film}/{region}
                   (all 4 series present), each <500ms
§8 approval SSE echo: open stream, POST /approve → assert approval.granted event
                      lands on the still-open stream
§9 live e2e latency cap: POST /inject-crisis → pipeline.completed under 180s
                         (matches Layer 3b §9 cap)
```

### Regression discipline

`agents/**` gains exactly two touchpoints — optional keyword-only
`on_event` param on `invoke_investigation` and `invoke_decision`.
Backward-compatible. Layer 3b acceptance sweep must still pass 9/9
after Layer 4 lands.

## Non-Goals

- No WebSocket support (SSE only — simpler, browser-native, unidirectional matches our data flow).
- No auth (hackathon demo scope).
- No horizontal scaling of runtime state (single-process; Cloud Run
  min=1 max=3 with sticky sessions or single-instance for demo window).
- No partial-fallback (documented above).
- No persistent event log (documented above).
- No Cloud Run deploy scripts (Layer 6).

## Open Questions Resolved

- **Q1:** All 6 endpoints + SSE + demo fallback in one plan (option A).
- **Q2:** Sub-agent-level SSE events (~22 per run) (option B).
- **Q3:** Refresh-and-SELECT with fallback-to-synth on 2s timeout (option C).
- **Q4:** In-memory registry with per-run replay buffer + fan-out (option B).
- **Q5:** Full cached triple + auto-swap on exception, `?fallback=force` override (option A).

## Success Criteria

1. `PYTHONPATH=. venv/bin/python -m api.tests.acceptance` — 9/9 pass.
2. Layer 3b acceptance still 9/9 (regression).
3. `uvicorn api.main:app` boots in <3s locally; first `/inject-crisis`
   completes end-to-end within 180s.
4. Frontend (Layer 5) can render the full dashboard using only these
   endpoints.
