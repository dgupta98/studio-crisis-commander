# Telemetry Empty — Root Cause

**Symptom:** TelemetryStrip renders "no telemetry" placeholders across all 4 sparklines (the italic "no data" branch inside `Sparkline` when `data.length === 0`).

Backend under test: `https://scc-api-845114229642.us-east1.run.app` (Cloud Run, redeployed for Phase 1).
Frontend routes probed: `/metrics/{film_id}/{region}` (the actual endpoint — the task text's `/metrics/rollup?film_id=…&region=…` string is a documentation slip; that path returns `{"detail": "Not Found"}` and is not what the frontend calls; see `frontend/src/store/runStore.ts:167`).

## Investigation

### H1 (backend empty): **PASS** — this is the observed symptom's proximate cause.

Rollup tables are almost entirely empty for the film/region combos the UI defaults to.

Evidence — `film_id=1, region=US, hours=48` (the frontend's typical fire path):

```
$ curl -sS "$BASE/metrics/1/US" | python3 -m json.tool
{
    "film_id": 1,
    "region": "US",
    "hours": 48,
    "timeseries": {
        "box_office_daily": [],
        "social_virality_hourly": [],
        "sentiment_hourly": [],
        "trailer_hourly": []
    },
    "query_latency_ms": 16142
}
```

Same all-empty result at `hours=720`. Confirmed across Japan / UK / Germany / France / India / Mexico / Global — all four families empty for film_id=1.

`/catalog/films/{id}` corroborates: every film 1-10 reports `signals.box_office = 0`, `signals.reviews = 0`, `signals.streaming = 0`; `signals.social` sits at 0-15. `/stats/summary` reports `rows_scanned_24h: 4` — the intake pipeline has essentially not landed data in the last day.

Only exception found: `film_id=1, region=Brazil, hours=720` returns 5 points each for `social_virality_hourly` and `sentiment_hourly` (box_office and trailer still empty). That was the only combo out of ~15 probed that returned any rows.

### H2 (shape mismatch): **PASS** — latent bug that will surface as soon as H1 is fixed.

The wire shape returned by `/metrics/{film_id}/{region}` does **not** match `MetricsResponse` in `frontend/src/api/contracts.ts`.

Contract (`frontend/src/api/contracts.ts:161-176`) declares each series as `MetricPoint[]` with `MetricPoint = { ts: string; value: number }`.
`frontend/src/components/Sparkline.tsx:36` binds `<Line dataKey="value" …>`.

Actual response for `film_id=1, region=Brazil, hours=720`:

```json
"social_virality_hourly": [
  { "ts": "2026-08-10 10:00:00", "avg_virality": 8.0, "volume": 8 },
  …
],
"sentiment_hourly": [
  { "ts": "2026-08-10 10:00:00", "avg_score": -8.0, "volume": 128000 },
  …
]
```

Per-family keys the backend actually returns (from `backend/api/routers/metrics.py:84-93`, `cols` tuples):
- `box_office_daily`: `ts, revenue_usd, tickets_sold`
- `social_virality_hourly`: `ts, avg_virality, volume`
- `sentiment_hourly`: `ts, avg_score, volume`
- `trailer_hourly`: `ts, views, completion_rate`

**None of the four families have a `value` field.** As soon as the rollup tables are populated, `Sparkline` will still draw a blank chart (line with all-`undefined` y-values) because `dataKey="value"` resolves to `undefined` on every point. The current "no data" placeholder actually masks this — arrays are empty, so `Sparkline` short-circuits before it would have exposed the shape mismatch.

### H3 (URL / CORS): **FAIL** — not the cause.

The frontend's `loadMetrics` call path is `/metrics/${filmId}/${encodeURIComponent(region)}?hours=${hours}` (`frontend/src/store/runStore.ts:164-180`), which matches the backend router `@router.get("/metrics/{film_id}/{region}")` at `backend/api/routers/metrics.py:78`. The endpoint responds 200 with a well-formed envelope (see H1 evidence). If `VITE_API_URL` were misconfigured, `apiGet` would throw and the store would set `apiReachable=false`, not populate `metrics[key]` with empty arrays — which means the "no data" placeholders wouldn't appear either (the wrapper would render an error/idle state instead). `frontend/cloudbuild.yaml` bakes `_VITE_API_URL` at build time; `.env.production` is intentionally blank so the substitution is required, but that's a deploy-config concern orthogonal to the observed symptom.

## Root cause

Two bugs stacked. The **presenting** cause is H1: the ClickHouse rollup tables (`roll_social_hourly`, `roll_sentiment_hourly`, `roll_trailer_hourly`, `box_office_revenue`) are effectively empty for the film/region combos the frontend defaults to (film 1 across US and most regions), so `/metrics/{film_id}/{region}` legitimately returns four empty arrays and `Sparkline` renders its "no data" branch. The **latent** cause is H2: the frontend `MetricsResponse` contract and the `Sparkline` component both assume a `{ts, value}` point shape, but the backend returns per-family rich rows (`{ts, revenue_usd, tickets_sold}`, `{ts, avg_virality, volume}`, `{ts, avg_score, volume}`, `{ts, views, completion_rate}`). Even if the pipeline backfilled data tomorrow, the sparklines would render as flat blank lines because `dataKey="value"` resolves to `undefined` on every point.

## Fix strategy for Task 16

- **Fix H2 first — it's cheap and unblocks the visual regardless of data volume.** Pick one of:
  (a) Update `MetricsResponse`/`MetricPoint` in `frontend/src/api/contracts.ts` to a discriminated per-family shape, then have `TelemetryStrip` map each family to a canonical `{ts, value}` before handing to `Sparkline` (project `revenue_usd`, `avg_virality`, `avg_score`, `views` respectively); OR
  (b) Change `backend/api/routers/metrics.py` `_run(...)` `cols` tuples and the response envelope to emit `{ts, value}` per family, keeping the "which column is `value`" mapping server-side. Option (a) preserves richer data for future use; option (b) is a smaller diff. Recommend (a).
- **Add a Vitest that reproduces the shape bug**: feed `Sparkline` a fixture of `[{ts, avg_virality: 8, volume: 4}, …]` and assert the rendered `<path>` d-attribute is non-empty / y-values are finite. This is the guard that prior 3 fix attempts lacked — they were probably testing against the wrong (frontend-shaped) fixture, so the mismatch never blew up in CI.
- **Address H1 as data/pipeline follow-up**, not in Task 16 — pick a demo `film_id, region` known to have rollup rows (film_id=1/Brazil is the only one confirmed populated right now) for the default detection path, or extend the fallback fixture at `backend/api/cached/fallback_triple.json` so the panel has meaningful data to render in the empty-DB case. `/stats/summary`'s `rows_scanned_24h: 4` suggests the intake/materialised-view pipeline needs a separate look; that is out of scope for a UI-fix task.
