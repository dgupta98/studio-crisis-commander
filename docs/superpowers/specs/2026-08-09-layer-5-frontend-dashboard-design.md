# Layer 5 — Frontend Dashboard — Design Spec

**Date:** 2026-08-09
**Layer:** 5 (Cinematic Dashboard)
**Depends on:** Layer 4 (Orchestration API — /inject-crisis, /stream, /detections, /audit, /approve, /deny, /metrics)
**Enables:** Layer 6 (Submission polish — video, deploy, docs)

## Goal

A single-screen cinematic ops center that consumes the Layer 4 API and
renders the four-agent pipeline as a live, editorial, unrehearsed
experience: idle → inject → detect → investigate → decide → approve.
Static-serve on Cloud Run behind the same infra pattern as the backend.
Every panel obeys the 5-state discipline (idle / loading / success /
empty / error). One choreographed 30-second inject sequence is the
hero moment; the other six panel states in BUILD_REPORT §6 are all
built, polished uniformly.

## Architecture

One SPA (Vite + React 18 + TypeScript), single Zustand store, single
EventSource per run. All API access flows through store actions; panels
are pure-render and depend only on the store. The store owns the
`SSE → typed events → derived slices` pipeline; a `derivePanelStates`
selector computes the per-panel 5-state from the store's data +
`streamState`, so panels never conditionally-render themselves.

Boundary: `panels/*` may only import from `store/`, `api/contracts`,
`components/`, `motion/`, `theme/`. They MUST NOT import
`api/client.ts` or `api/sse.ts`. This mirrors Layer 4 §1's boundary
grep discipline — enforced by `frontend/tests/boundaries.test.ts`.

Reconnect model: the server (Layer 4 §6) replays the full event log
on late subscriber; the client dedupes by `event.seq`. No client-side
`lastEventId` bookkeeping.

## Tech Stack

Locked during brainstorming (see this doc's parent conversation):

| Concern | Choice | Why |
|---|---|---|
| Build | Vite 5 | Fast dev, hashed asset output |
| Runtime | React 18 | Mature, matches README declaration |
| Language | TypeScript 5 | Mirrors Layer 4's Pydantic contracts at compile time |
| Styling | Tailwind 3 | Disciplined spacing + typography scale |
| Motion | Framer Motion 11 | Cinematic reveals with cinematic easing (no spring bounce) |
| State | Zustand 4 | 1 KB, no context wrangling, demo-friendly |
| Charts | Recharts 2 | Locked in README; sufficient for sparklines |
| Testing | Vitest + Testing Library + Playwright (Chromium only) | Fast unit + one e2e |
| Runtime image | nginx:1.27-alpine | Static serve on Cloud Run |

No auth. No SSR. No component library (build primitives; the design is
too bespoke for shadcn out-of-box).

## File Layout

```
frontend/
  package.json
  vite.config.ts
  tailwind.config.ts
  tsconfig.json
  Dockerfile               # multi-stage: node build + nginx runtime
  nginx.conf               # SPA history fallback, gzip, cache-control
  index.html
  src/
    main.tsx
    App.tsx                # <OpsCenter/> layout shell
    api/
      client.ts            # fetch wrapper, VITE_API_URL, throws on non-2xx
      contracts.ts         # TS mirrors of backend/api Pydantic contracts
      sse.ts               # openStream() — EventSource wrapper
    store/
      runStore.ts          # single Zustand store (see below)
    panels/
      HeroBanner.tsx
      TelemetryStrip.tsx
      AnomalyFeed.tsx
      AgentTrace.tsx
      RecommendationPanel.tsx
      ApprovalGate.tsx
      InjectControls.tsx
      HistoryDrawer.tsx
    components/
      Button.tsx
      Card.tsx
      Sparkline.tsx        # Recharts wrapper w/ cinematic ease
      Popover.tsx
      SqlBlock.tsx         # mono block, syntax-tinted, copy button
      PanelStateWrapper.tsx  # THE 5-state gate — every panel wraps in this
      SeverityChip.tsx
    motion/
      choreography.ts      # Framer Motion variants + tokens
    theme/
      tokens.ts            # design tokens exported for JS-side use
      tailwind.tokens.ts   # same tokens compiled to Tailwind theme
    tests/
      setup.ts
      unit/
        runStore.test.ts
        sse.test.ts
        contracts.test.ts
        panelStateWrapper.test.tsx
      e2e/
        hero-flow.spec.ts
      boundaries.test.ts
      acceptance.ts        # 5-check sweep mirror of backend/api/tests/acceptance.py
```

## Component Tree

```
<App>
  <OpsCenter>                            grid-rows: [hero, telemetry, main, drawer]
    <HeroBanner/>                        full-width, film-card
    <TelemetryStrip/>                    4 sparklines + latency chip
    <div class="grid grid-cols-[3fr_2fr]">
      <AgentTrace/>                      centerpiece, 60% column
      <aside>                            40% column, stacked
        <AnomalyFeed/>
        <RecommendationPanel/>
          └── <SqlBlock/> inside <Popover>   ← provenance drill-down
        <ApprovalGate/>
        <InjectControls/>
      </aside>
    </div>
    <HistoryDrawer/>                     collapsed by default, bottom
  </OpsCenter>
</App>
```

Every panel wraps in `<PanelStateWrapper state={store.panelStates.<name>}>` —
this is the single place the 5-state discipline is enforced.

## Store — `store/runStore.ts`

Single Zustand store. State + derived selectors + actions.

```typescript
interface RunStore {
  // data
  runId: string | null
  events: SseEvent[]
  detection: DetectionRow | null
  findings: Finding[]
  decision: DecisionResult | null
  report: ExecutiveReport | null
  approvalStatus: 'pending' | 'approved' | 'denied' | null
  mode: 'live' | 'fallback' | null
  recentDetections: DetectionRow[]
  auditRows: AuditRow[]
  metrics: Record<string, MetricsResponse>   // key: `${filmId}:${region}`
  latencyMs: number | null

  // stream
  streamState: 'idle' | 'connecting' | 'streaming' | 'closed' | 'error'
  apiReachable: boolean               // false when /detections load throws on first load
  panelStates: {
    hero: PanelState
    telemetry: PanelState
    anomaly: PanelState
    trace: PanelState
    recommendation: PanelState
    approval: PanelState
    history: PanelState
  }
  // InjectControls is always interactive — it has local button-level state
  // (idle / submitting / disabled-while-run-in-flight), not the async 5-state
  // pattern that PanelStateWrapper governs.

  // actions
  inject(opts?: {crisisType?: CrisisType; fallback?: 'force'}): Promise<string>
  connectStream(runId: string): void
  approve(decisionId: string, note?: string): Promise<void>
  deny(decisionId: string, reason: string): Promise<void>
  loadDetections(limit?: number): Promise<void>
  loadAudit(limit?: number): Promise<void>
  loadMetrics(filmId: number, region: string, hours?: number): Promise<void>
  reset(): void
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; substatus?: string }
  | { kind: 'success' }
  | { kind: 'empty'; hint?: string }
  | { kind: 'error'; message: string; retry?: () => void }
```

**Event routing.** `connectStream` opens `EventSource(/stream/investigation/{runId})`.
On each message: parse JSON, dedupe by `event.seq`, append to
`events[]`, then dispatch by `event.type`:

| Event type | Mutation |
|---|---|
| `detection.completed` | set `detection`; auto-fire `loadMetrics(detection.film_id, detection.region)` |
| `signal.completed` | push into `findings` |
| `action.impact_computed` | merge into `decision.actions[i].impact` (if `decision` present) |
| `decision.completed` | set `decision` |
| `report.completed` | set `report` |
| `approval.granted` / `.denied` | update `approvalStatus` |
| `pipeline.completed` | `streamState = 'closed'`; close EventSource |
| `pipeline.failed` | `streamState = 'error'`; keep events for post-mortem |
| any event with `data.mode` | set `mode` if not yet set |

**Derived panel states.** `derivePanelStates(state)` is called on every
store update. It maps `(streamState, apiReachable, data-presence,
hasRun)` into one of the 5 states per panel — panels don't compute
their own state. When `apiReachable === false`, anomaly + history →
`error` with retry; hero + telemetry + trace + recommendation +
approval stay `idle` (they're run-scoped, no run means no error).
ApprovalGate's approve/deny 4xx/5xx errors are local button-level
state — surfaced inline under the button, not through PanelStateWrapper.

## SSE Consumer — `api/sse.ts`

```typescript
export function openStream(
  runId: string,
  onEvent: (e: SseEvent) => void,
  onError: (e: Error) => void,
): () => void {
  const es = new EventSource(`${API_URL}/stream/investigation/${runId}`)
  es.onmessage = (msg) => onEvent(JSON.parse(msg.data))
  es.onerror = () => onError(new Error('stream error — awaiting reconnect'))
  return () => es.close()
}
```

Only `store.connectStream` calls this. EventSource auto-reconnects on
transient network errors; the server replays the full log; the store
dedupes by `seq`.

## Design Tokens

### Color palette — Newsroom hybrid

| Token | Value | Use |
|---|---|---|
| `paper` | `#FBFAF7` | app background |
| `card` | `#FFFFFF` | panel background |
| `card-alt` | `#EFECE4` | mono blocks, secondary surfaces |
| `ink` | `#111111` | primary text |
| `ink-soft` | `#4a4a4a` | secondary text, labels |
| `accent` | `#A31621` | brand red, active state, key CTAs |
| `sev-info` | bg `#E8E5DA` / fg `#4a4a4a` | routine anomaly |
| `sev-warn` | bg `#F0D9A0` / fg `#6b4a10` | elevated anomaly |
| `sev-crit` | bg `#E5C0BC` / fg `#831818` | critical anomaly |
| `line` | `#E5E1D6` | subtle divider |

### Typography

| Role | Family | Weight | Notes |
|---|---|---|---|
| Display (hero titles, section H1) | Georgia (system serif) | 700 | Letter-spacing `-0.02em`; newsroom register |
| Body / labels / captions | Inter (self-hosted woff2) | 400/500/600 | System stack fallback |
| Numbers / data | Inter, `font-variant-numeric: tabular-nums` | 600 | Tight `-0.02em`, snap-to-grid |
| Monospace (SQL, run_id) | JetBrains Mono (self-hosted woff2) | 400 | Uppercase for chip labels |

Self-host both webfonts under `frontend/public/fonts/` to keep the
demo offline-capable and avoid Google Fonts CORS in the video record.
Ship weights 400/500/600 in latin subset only (woff2). Georgia is a
system serif — no font file needed.

### Motion tokens

| Token | Value |
|---|---|
| `ease.cinematic` | `[0.16, 1, 0.3, 1]` |
| `ease.brisk` | `[0.4, 0, 0.2, 1]` |
| `duration.reveal` | `700ms` |
| `duration.transition` | `400ms` |
| `duration.micro` | `160ms` |
| `duration.count` | `1200ms` |
| `stagger` | `90ms` |
| `blur.enter` | `4px → 0` |

`@media (prefers-reduced-motion: reduce)` collapses all durations to 0
and disables count-up animations.

## Inject Sequence Choreography

Driven by real SSE events; the choreography is the reveal timing on
each event, not a scripted timeline.

```
t=0     user clicks INJECT
        └─ button: 160ms scale 1→0.96→1 (micro, brisk)

t=200   POST /inject-crisis returns; run_id received; SSE opens

t=400   telemetry sparkline of affected metric visibly bends downward
        ├─ line: draw-in left→right (700ms, cinematic)
        └─ trailing marker dot follows last point

t=~800  detection.completed
        ├─ HeroBanner: fade+lift-in y=+12, blur 4→0 (700ms)
        └─ AnomalyFeed: severity chip slides in from x=-16, pulses 2x

t=1200  investigation.started
        ├─ AgentTrace: first row fades in with typing caret
        └─ hero magnitude number: count-up 0 → value (1200ms)

t=~5-15s  signal.completed × 4 (staggered)
        ├─ each row: 90ms stagger, blur→0
        └─ MCP query mono block reveals w/ typewriter (400ms)

t=~19s  decision.completed
        ├─ RecommendationPanel: reveal (700ms)
        ├─ action rows: 90ms stagger
        └─ impact numbers: count-up (1200ms)

t=~20s  report.completed
        ├─ ApprovalGate: reveal (700ms), approve button subtly pulses on first appearance
        └─ key_figure numbers: count-up in order

t=~20.5s pipeline.completed — elapsed chip in HeroBanner subtitle
```

Fallback replay uses the same choreography paced faster (~12s total);
`mode: "fallback"` events surface a monochrome `REPLAY` chip in the
HeroBanner corner. No attempt to hide fallback mode.

## Panel States + Error Handling

Every panel renders through `<PanelStateWrapper state={...}>`, which
selects between the 5 states. State-per-panel is derived from the
store, not computed inside the panel.

**Error handling matrix:**

| Failure | Detection | Recovery |
|---|---|---|
| Backend unreachable on page load | `/detections` fetch throws | AnomalyFeed → `error` w/ retry; other panels stay `idle`. Toast: "API unreachable" |
| `/inject-crisis` returns 5xx | inject action throws | InjectControls inline error under button; store unchanged |
| SSE drops mid-run | `EventSource.onerror` | `streamState = 'error'`; EventSource auto-reconnects; server replays; store dedupes by `seq`. Trace shows subtle "reconnecting…" chip during gap |
| `pipeline.failed` event | event handler | `streamState = 'error'`; keep events; hero shows failure banner; trace shows failed step in red; recommendation/approval → `error` w/ `event.data.error` |
| Backend recovered via fallback | `event.data.mode === 'fallback'` | store `mode = 'fallback'`; monochrome REPLAY chip. Not an error — success from cached triple |
| `/approve` returns 4xx (already approved) | approve action | Inline "Already approved by X" — informational |
| `/approve` returns 5xx | approve action | ApprovalGate shows retry button; button stays enabled |

**Explicitly not handled:** offline mode, optimistic approve/deny UI,
retry-with-backoff on inject.

## Testing Strategy

**Unit (Vitest + Testing Library):**
- `store/runStore.test.ts` — one test per SSE event type → correct mutation
- `api/contracts.test.ts` — parse `backend/api/cached/fallback_triple.json`
  fixtures against TS types (guards drift from Pydantic)
- `api/sse.test.ts` — mocked EventSource: reconnect + dedupe by `seq`
- `panels/PanelStateWrapper.test.tsx` — one test per state
- **Skipping:** component snapshot tests (rot fast, don't catch bugs)

**E2E (Playwright, Chromium only):**
- `tests/e2e/hero-flow.spec.ts` — golden path against live backend in
  fallback mode:
  1. Load `/` → idle state visible
  2. Click Inject → 202
  3. Wait for `pipeline.completed` → hero + trace + recommendation +
     approval all render
  4. Click Approve → 200 → approval chip flips

**Skipping:** cross-browser matrix, visual regression, mobile viewports.

Rough budget: ~15 unit tests + 1 Playwright e2e. Inflate only if TDD
forces it; don't add tests for coverage's sake.

## Boundaries (§1 grep discipline)

Enforced by `frontend/tests/boundaries.test.ts`:

- `panels/**/*.tsx` MUST NOT import from `api/client` or `api/sse`
- `components/**/*.tsx` MUST NOT import from `api/*` or `store/*`
- `store/runStore.ts` is the ONLY file that owns EventSource lifecycle

## Acceptance Sweep

`frontend/tests/acceptance.ts` — 5 checks (mirror of
`backend/api/tests/acceptance.py`):

| § | Check |
|---|---|
| §1 | Boundary grep — panels don't import `api/*` |
| §2 | `tsc --noEmit` clean |
| §3 | `vite build` exit 0 (with `VITE_API_URL=http://localhost:8000`) |
| §4 | `vitest run` passes |
| §5 | Playwright hero-flow.spec.ts passes against live backend in fallback mode |

## Deployment

**Dockerfile (multi-stage):**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
```

**Deploy:**

```bash
gcloud run deploy scc-frontend \
  --source frontend/ \
  --region us-east1 \
  --allow-unauthenticated \
  --build-arg VITE_API_URL=https://scc-api-....run.app
```

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_URL` | Backend base URL, injected at build time | `http://localhost:8000` |

No auth, no analytics, no secrets.

## Deferred to Layer 6 (post-freeze polish)

- Film grain overlay on hero banner
- Widescreen letterbox framing on hero
- Sound design (mute-by-default detection chime)
- Additional viewport support beyond 1080p

## Non-goals

- No mobile / tablet viewports (single-screen ops center @ 1080p)
- No i18n
- No user accounts, roles, or auth (judges just watch)
- No offline mode
- No SSR / hydration (Vite SPA, static hosting)
- No design system extraction — components stay bespoke to this project
