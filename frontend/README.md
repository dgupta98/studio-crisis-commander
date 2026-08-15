# Frontend (Layer 5)

Cinematic-modern ops center for Studio Crisis Commander. Consumes the
Layer 4 FastAPI backend over REST + SSE, renders the four-agent pipeline
as a live editorial experience.

## Boundaries

- `panels/*.tsx` MAY only import from `store/`, `api/contracts`, `components/`, `motion/`, `theme/`.
- `panels/*.tsx` MUST NOT import `api/client` or `api/sse`. (Exception: the shared `ApiError` type may be imported from `api/client` for `instanceof` checks.)
- `store/runStore.ts` is the ONLY file that owns the EventSource lifecycle.
- Enforced by `src/tests/boundaries.test.ts` (§1 grep).

## Layout

| File | Role |
| --- | --- |
| `src/App.tsx` | `<OpsCenter>` layout shell (full-width hero, 60/40 two-col) |
| `src/api/contracts.ts` | TS mirror of backend Pydantic contracts |
| `src/api/client.ts` | Fetch wrapper (`apiGet`, `apiPost`) |
| `src/api/sse.ts` | `openStream()` — EventSource wrapper |
| `src/store/runStore.ts` | Single Zustand store: state + event routing + derived panelStates |
| `src/theme/tokens.ts` | Newsroom-hybrid design tokens |
| `src/motion/choreography.ts` | Framer Motion variants |
| `src/components/PanelStateWrapper.tsx` | 5-state gate (idle / loading / success / empty / error) |
| `src/panels/*.tsx` | 8 panels — Hero, Telemetry, Anomaly, Trace, Recommendation, Approval, Inject, History |

## Running

Local dev (backend must be up):

```
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173.

## Testing

```
npm run test           # vitest — unit + component + boundary
npm run test:e2e       # playwright — hero-flow (backend must be running)
npm run acceptance     # 5-check sweep: boundaries + tsc + build + vitest + e2e
```

## Environment

- `VITE_API_URL` — backend base URL. Default `http://localhost:8000` for dev.
  Set at build time via `docker build --build-arg VITE_API_URL=https://...`.

## Deploy (Cloud Run)

```
gcloud run deploy scc-frontend \
  --source frontend/ \
  --region us-east1 \
  --allow-unauthenticated \
  --build-arg VITE_API_URL=https://scc-api-....run.app
```

## Spec

`docs/superpowers/specs/2026-08-09-layer-5-frontend-dashboard-design.md`
