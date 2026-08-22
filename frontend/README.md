# Frontend (Layer 7)

Cinematic-modern multi-route product surface for Studio Crisis Commander.
Consumes the FastAPI backend over REST + SSE, renders the four-agent
pipeline as a live editorial experience across Landing, Dashboard, Movies,
and Movie Detail routes.

## Boundaries

- `panels/*.tsx` MAY only import from `store/`, `api/contracts`, `components/`, `motion/`, `theme/`.
- `panels/*.tsx` MUST NOT import `api/client` or `api/sse`. (Exception: the shared `ApiError` type may be imported from `api/client` for `instanceof` checks.)
- `store/runStore.ts` is the ONLY file that owns the EventSource lifecycle.
- Enforced by `src/tests/boundaries.test.ts` (§1 grep).

## Layout

| Path | Role |
| --- | --- |
| `src/router.tsx` | React Router 6 route table (Landing, Dashboard, Movies, Movie Detail, Audit, Settings) |
| `src/components/AppShell.tsx` | Persistent shell (top bar + left nav + `<GlobalInjectModal>`) |
| `src/routes/*.tsx` | Route components — LandingRoute, DashboardRoute, MoviesRoute, MovieDetailRoute, AuditRoute, SettingsRoute |
| `src/landing/*.tsx` | HeroFold, AgentsFold, HowItWorksFold, CtaFold, ParticleCascade, LiveCounter |
| `src/panels/*.tsx` | Editorial panels — AgentTrace, AnomalyFeed, RecommendationPanel, ApprovalGate, TelemetryStrip, IntakeStrip, MovieHero, LatestInvestigation, RunTimeline, AmbientTelemetry, … |
| `src/components/` | Primitives — SignalChip, LatencyBadge, RegionFlag, MovieCard, Shelf, FeaturedHero, PanelStateWrapper |
| `src/store/` | Zustand stores — runStore (SSE + panel state), catalogStore, signalStore |
| `src/hooks/` | useIntakeRates, useFilm, useCachedTriple, useRegion, useReducedMotion |
| `src/api/contracts.ts` | TS mirror of backend Pydantic contracts |
| `src/api/client.ts` | Fetch wrapper (`apiGet`, `apiPost`) |
| `src/api/sse.ts` | `openStream()` — EventSource wrapper |
| `src/theme/tokens.ts` | Signal-family color tokens (blue/pink/yellow/green + `fg` variant) |

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

`gcloud run deploy --source` does not forward `--build-arg` to Cloud Build,
so the two-step image push is the reliable path when the bundle needs a
build-time env baked in:

```
docker build \
  --build-arg VITE_API_URL=https://scc-api-....run.app \
  -t gcr.io/PROJECT_ID/scc-frontend:latest \
  frontend/
docker push gcr.io/PROJECT_ID/scc-frontend:latest

gcloud run deploy scc-frontend \
  --image gcr.io/PROJECT_ID/scc-frontend:latest \
  --region us-east1 \
  --allow-unauthenticated
```

## Spec

- Current surface: `docs/superpowers/specs/2026-08-16-layer-7-ui-revamp-design.md`
- Original dashboard: `docs/superpowers/specs/2026-08-09-layer-5-frontend-dashboard-design.md`
