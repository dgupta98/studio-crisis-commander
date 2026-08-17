# Layer 7 — UI Revamp Design

> **Status:** Spec approved through brainstorm §1-8. Awaiting user review (brainstorm §8). Implementation plan (writing-plans) is the next step.

**Goal:** Replace the single-page OpsCenter with a full multi-route SPA — cinematic landing, live-ops dashboard, Netflix-style movies catalog, executive-brief movie detail page — that sells the project's USP ("crises detected as data lands in ClickHouse") on every surface.

**Deadline:** Sep 7, 2026 · 22 days from spec date · ~100-124 hrs estimated. Front-loaded backend work, compressible polish phase, submission Sep 6.

**One-line summary:** Full IA replacement, three USP surfaces, curated + lazy movie pre-runs, chromeless landing → persistent app shell, canvas cinematic motion — every design choice picked the maximum-ambition option.

---

## Locked Decisions

| # | Question | Choice | Rationale |
|---|---|---|---|
| Q1 | Scope | **A — Full replacement** | OpsCenter dissolves into new routes; eval + Devpost + video re-anchored to new UI. |
| Q2 | Movie pre-runs | **B+C hybrid** | Featured films (~15) use cached triples in `data/eval_cache/`; non-featured films run live on click. |
| Q3 | App shell | **A — Chromeless landing → persistent nav** | Landing is a title card; shell begins after CTA. |
| Q4 | USP treatment | **C — All three surfaces** | Landing cascade + Dashboard intake strip + per-detection latency badges. |
| Q5 | Landing depth | **C — Full deck** | Hero → 4 agents → how-it-works → live counter → CTA. |
| Q6 | Movie cards | **C — Data card** | Poster + signal delta + region flag + latency per card. |
| Q7 | Movie detail | **C — Executive brief + persistent trace** | Report headline first; agent trace always visible (amendment to base C). |
| Q8 | Motion | **C — Full cinematic** | Canvas particle systems + page transitions + glow FX. Signal-family palette as first-class tokens. |

**Section 4 amendments:** AnomalyFeed capped at 8 rows (overflow into `/history`). Cached triples for the last 8 detections are React Query-prefetched on Dashboard mount so clicking any row instantly flips the workspace to State B without a spinner.

---

## Architecture

### Routes (React Router v6)

```
/                     Landing (chromeless, no shell)
/dashboard            Live ops (default post-CTA landing)
/movies               Movies index (shelves)
/movies/:filmId       Movie detail (executive brief + trace)
/history              Audit log (promoted from drawer to route)
/about                Compliance / TMDB credit / methodology
```

- `/` renders `<LandingLayout>` — no left nav, no header chrome.
- All other routes render `<AppShell>` — persistent left nav, sticky top bar with global Inject Crisis, breadcrumb.
- Route transitions handled by Framer Motion `<AnimatePresence mode="wait">` with cross-fade + y +8→0 (150ms enter / 100ms exit).

### New dependencies

- `react-router-dom@6` — new dep (frontend was single-page).
- **No** `three.js` — particle systems use Canvas 2D API in a ~200 LoC module (`frontend/src/motion/particleSystem.ts`).
- Existing state management (Zustand) retained. Two new sibling stores:
  - `catalogStore` — film index, shelves, recentlyViewed localStorage.
  - `signalStore` — intake rates for USP strip.

### Backend endpoint delta

| Endpoint | Purpose | Consumer |
|---|---|---|
| `GET /catalog/shelves` | Curated shelf definitions with film IDs | Movies index |
| `GET /catalog/films/:id` | Film metadata + latest signal + latest cached run | Movie detail |
| `GET /catalog/films/:id/runs?limit=20` | Past runs for timeline | Movie detail Section D |
| `GET /catalog/search?q=` | Fuzzy title search | Search box (top bar) |
| `GET /intake/rates` (SSE) | Per-signal-family rows/sec + `detection.landed` events | Dashboard intake strip |
| `GET /stats/summary` | Crises today, avg detection latency, active runs | Landing Fold 4 live counter |
| **Existing (unchanged):** `/inject-crisis`, `/stream/investigation/:runId`, `/detections`, `/audit`, `/approve`, `/deny`, `/metrics/:film/:region`, `/health` | — | — |

Detection latency (`latency_ms` field) captured via small mod to detection agent: `latency_ms = (detection_ts - signal_ts) * 1000`. Added to Pydantic contract; propagates through SSE and cached triples.

### Migration strategy

- `frontend/src/panels/OpsCenter.tsx` deleted; its 8 panels redistributed:
  - `TelemetryStrip`, `AgentTrace`, `RecommendationPanel`, `ApprovalGate`, `AnomalyFeed`, `HeroBanner` → refactored into new routes as noted per-section.
  - `HistoryDrawer` promoted to `/history` route.
  - `InjectControls` panel deprecated; replaced by `<GlobalInjectModal>` reachable from top bar (Section 3).

---

## Section 2 — Landing page (`/`)

**Purpose:** Marketing surface. Cinematic title card + agent explainer + how-it-works + live proof-of-life.

### Layout (four folds, snap-scroll)

**Fold 1: Title card (100vh)**
- Fullscreen `bg-[#08080c]`. Canvas-rendered 4-lane particle cascade behind copy (Q7.2).
- Center-aligned:
  - Eyebrow: `STUDIO CRISIS COMMANDER`
  - Headline: `Four agents.` / `One weekend crisis.` (display, 5xl-7xl)
  - Sub: `Detection · Investigation · Decision · Report — over signals landing in ClickHouse in real time.`
  - CTA: `Enter Control Room ↓` (scrolls to Fold 4; also skips folds)
- Ambient pulsing chevron at bottom as scroll hint.

**Fold 2: Meet the agents (100vh)**
- Section title: `Four agents. Each with one job.`
- 4 cards horizontal strip, each with left-border in signal-family color:
  - **Detection** (blue) — "Pure SQL. Materialized views fire the moment a threshold breaks."
  - **Investigation** (pink) — "Gemini probes ClickHouse. 5-10 grounded queries per case."
  - **Decision** (yellow) — "Recommends actions with SQL-backed impact estimates."
  - **Report** (green) — "Exec-ready brief. Every figure links to its source query."
- Each card hover reveals a real code/trace excerpt from `data/eval_cache/`.

**Fold 3: How it works (100vh)**
- Section title: `Detection happens as data lands.`
- Left half: animated data-flow diagram (SVG + Framer Motion). Row → CH table → MV rewrites → detection agent → pipeline. Signal-family colors.
- Right half: three bullet callouts:
  - `~1s p50 detection latency` — from row insert to agent fire
  - `Grounded in the same DB` — investigation reads what detection saw
  - `Human gates the money moves` — approval-required actions above threshold

**Fold 4: Live counter + CTA (60vh)**
- Section title: `It's running right now.`
- Three tickers from `GET /stats/summary` (polled 5s):
  - `{crises_today}` · `crises detected today`
  - `{avg_latency_s}` · `avg ingestion → detection`
  - `{active_runs}` · `active runs` (pulse dot if >0)
- Primary CTA: `Enter Control Room →` (routes to `/dashboard`).
- Secondary link: `See a movie in crisis →` (routes to `/movies` filtered to In Crisis shelf).
- Footer: TMDB attribution, GitHub, hackathon badge.

### Empty-state safety

If `/stats/summary` fails or returns zeros, Fold 4 falls back to the ceremonial line `Ready when you are.` — never shows dashes/zeros.

### Accessibility

- `prefers-reduced-motion` disables cascade + parallax; static gradient replaces.
- All animations decorative; content fully accessible without them.

---

## Section 3 — App Shell (`<AppShell>`)

**File:** `frontend/src/layout/AppShell.tsx`. Wraps every route except `/`.

### Left nav rail (220px)

- Sticky, full-height, `bg-[#0b0b12]`, 1px right border `#1a1a25`.
- Logo lockup at top (SCC monogram in amber, 48px). Clicking routes to `/`.
- Nav items (active state = signal-family accent bar on left):
  - `◐ Dashboard` → `/dashboard`
  - `▦ Movies` → `/movies`
  - `◷ History` → `/history`
  - `ⓘ About` → `/about`
- "System" cluster below nav items:
  - Live pulse dot + `Backend healthy` (polls `/health` every 30s; red on fail).
  - Build sha (`import.meta.env.VITE_GIT_SHA` last 7 chars) as monospace label.
- Collapses to 64px icon rail below `lg` breakpoint via hamburger. Persisted in localStorage.

### Top bar (56px)

- Left: breadcrumb populated from route match (`Movies / {film.title}` etc.).
- Center: search box (only on `/movies` and `/movies/:id`, dispatches `catalogStore.search`). Icon-triggered, expands on click.
- Right cluster:
  - `+ Inject Crisis` — opens `<GlobalInjectModal>`. On submit, routes to `/movies/{film_id}` (or `/dashboard` if no film) and connects SSE stream.
  - Small pill: `N active` (from `runStore` streaming count), muted when 0.

### Layout primitives

- `<PageHeader title subtitle actions>` — 48px top padding, 24px bottom.
- `<PageBody>` — max-width `7xl`, horizontal padding `6`, vertical spacing `6`.
- `<Section title>` — inner section wrapper.

### Preserved primitives (from L5)

`<Card>`, `<Button>`, `<Popover>`, `<SqlBlock>`, `<SeverityChip>`, `<Sparkline>`, `<PanelStateWrapper>` — reused as-is.

### New primitives

- `<SignalChip signal="social" />` — signal-family colored chip.
- `<LatencyBadge ms={1400} />` — see Section 7.4.
- `<RegionFlag code="BR" />` — emoji flag + label.

### Route transitions

`<AnimatePresence mode="wait">` at outlet. Enter: opacity 0→1 + y +8→0, 150ms. Exit: opacity 1→0, 100ms. `prefers-reduced-motion` disables.

### Keyboard shortcuts

- `⌘K` / `Ctrl+K` — focus search (routes to `/movies` if not there).
- `I` — open Inject modal.
- `Esc` — close modal / popovers.
- `?` — help overlay listing shortcuts.

### State providers

`<BrowserRouter>` → `<QueryClientProvider>` → app. Zustand stores accessed via hooks, no provider needed.

---

## Section 4 — Dashboard (`/dashboard`)

**Purpose:** Live ops surface. Signals landing, detections firing, agents working, actions awaiting approval.

### Row 1 — USP Intake Strip (~120px, full width)

See Section 7.3 for full spec. Summary: 4 lanes (blue box_office / pink social / yellow reviews / green streaming), each showing live rate + micro-sparkline, lane pulses on `detection.landed` for that family.

### Row 2 — 2-column grid

**Left column (2fr) — Live Workspace:**

- **State A (no active run — default):** Full-height card with dim particle background (lower-density variant of landing cascade), centered copy `Ready. Inject a crisis or wait for one to fire.` with two CTAs (`+ Inject Crisis` opens modal, `See featured movies →` routes to `/movies`). Empty must still be watchable.
- **State B (run streaming or cached triple loaded):**
  - Top sub-card: `<TelemetryStrip>` (existing, reused, telemetry bug fixed — see 8.3).
  - Middle (~50% column height): `<AgentTrace>` (existing, with L6 bounded scroll + auto-follow).
  - Bottom: `<RecommendationPanel>` (existing).
- **State C (awaiting approval):** Identical to B, but `<RecommendationPanel>` bordered in yellow and pulses; ApprovalGate in right column pulses in sync.

**Right column (1fr) — Feed + Gate stack:**

- **Top: AnomalyFeed** (existing, capped at 8 rows per amendment; older overflow to `/history`).
  - Each row: `<SignalChip>` + film title + `<RegionFlag>` + `<LatencyBadge>`.
  - Click → flips Workspace to State B for that run using prefetched cached triple (instant, no spinner). If no cache, opens SSE stream.
- **Bottom: ApprovalGate** (existing).
  - Empty state: `No decisions pending review.`

### Prefetch behavior (Section 4 amendment)

On Dashboard mount, React Query prefetches `/audit/{run_id}` or the cached triple for each of the 8 visible AnomalyFeed detections. Row click → instant State B flip. Falls back to SSE stream if cache missing.

### Interactions

- Click AnomalyFeed row → Workspace flips to State B.
- Approve/Deny in ApprovalGate → API call + card animate-out + AuditLog silent update.
- `+ Inject Crisis` from top bar or empty state → global modal → on submit, Dashboard flips to State B streaming.

### Header

`<PageHeader title="Dashboard" subtitle="Live crisis operations" actions={<QuickStats />}>` where QuickStats shows `N active runs · Xs avg detection latency` monospace.

### Motion

- Intake strip lane pulse: Framer Motion `animate={{ boxShadow: [...] }}` on detection event.
- Workspace state transitions: `<AnimatePresence mode="wait">` cross-fade + scale (0.98→1).
- AnomalyFeed row entry: existing `traceRowEnter` variant.

---

## Section 5 — Movies Index (`/movies`)

**Purpose:** Discovery surface. Netflix-style shelves; every card sells the USP.

### Row 1 — Featured Hero (400px)

- Rotating hero for top 3 films with `In Crisis` status (highest-severity active detection). Auto-cycles every 6s; hover halts.
- Each slide: full-bleed backdrop with dark gradient overlay, headline `{film.title} — {signal_family} in {region}`, sub `Detected {latency} after data landed`, CTA `Open the case →` (routes to `/movies/{film_id}`).
- Empty state (no active crises): rotates top 3 from Featured shelf with sub `Available for demo. Click Inject to open a case.`

### Row 2+ — Shelves (stacked, each 200-240px)

Shelf order top-to-bottom:

1. **Recently Viewed** — localStorage-driven, cap 12. Hidden entirely if empty.
2. **In Crisis Now** — films with active detections from `/detections`, cap 8. Ordered severity + recency.
3. **Featured** — curated ~15 films with cached triples in `data/eval_cache/`. Ordered by manual weight in `backend/catalog/shelves.py`.
4. **Trending Signals (24h)** — top 12 films by absolute signal delta magnitude across any signal family in the last 24h. Backend: `SELECT film_id, max(abs(z_score)) AS delta FROM anomaly_signals WHERE ts >= now() - INTERVAL 24 HOUR GROUP BY film_id ORDER BY delta DESC LIMIT 12`.
5. **New Releases** — TMDB release_date within last 90 days, cap 12.
6. **Popular in {region}** — region auto-detected via `navigator.language` mapped to region enum (`en-US → US-EAST`, `pt-BR → BRAZIL`, `ja-JP → JAPAN`, `ko-KR → KOREA`, etc.; fallback `US-EAST` for unmapped). Cap 12. Region flag in header. User can override via a region picker in shelf header.

### Shelf shell

- Header: shelf title (uppercase, tracking-wider, sm) + item count on right + optional badge (`🔴 3 live` on In Crisis Now).
- Horizontal scroll strip (`overflow-x-auto snap-x snap-mandatory scroll-smooth`).
- Left/right chevron buttons appear on hover.
- Cards render `<MovieCard variant="data" | "slim" />`:
  - `data` (featured with cached signals): poster thumb (80×110), title, year, region flag, latest signal chip with delta, latency badge. Border tinted by severity.
  - `slim` (unfeatured): poster thumb, title, year, `▸ Open case` hint.

### Prefetching

- On shelf mount, React Query prefetches `/catalog/films/:id` for first 4 visible cards.
- Card hover (>300ms) prefetches full cached triple.

### Search integration

- Top-bar search filters into "Search Results" surface replacing shelves with a single grid.
- `Esc` or empty query restores shelves.
- Uses `/catalog/search?q=` — fuzzy on title + year + region.

### Empty states

- Catalog endpoint fails: full-page cinematic empty state `Catalog unavailable. Trying again…` with retry button.
- Shelf-level failure: shelf renders skeleton cards + `Reload` micro-action; doesn't break other shelves.

### Header

`<PageHeader title="Movies" subtitle="{N} films tracked across {R} regions" actions={<ShelfFilters />}>` — ShelfFilters lets user toggle shelf visibility (localStorage-persisted).

### Motion

- Shelf entry: staggered card slide-in (30ms per card, y +12→0, opacity 0→1).
- Card hover: scale 1→1.03 + subtle glow if data variant.
- Hero cross-fade: 800ms opacity + 4% scale.

### A11y

- Shelves are `<section role="region" aria-label="Shelf name">`.
- Horizontal scroll accessible via arrow keys when strip focused.
- Hero rotation pausable via button; pauses on hover.

---

## Section 6 — Movie Detail (`/movies/:filmId`)

**Purpose:** Drill-down for a single film. Executive brief on top; agent trace always visible; live and cached runs cohabit.

### Section A — Hero (280px)

- Full-bleed backdrop with dark left-to-right gradient overlay.
- Left cluster: poster thumb (120×180), title (display 3xl), tagline, release year · director · genre chips, region selector (defaults to region with active detection or largest audience).
- Right cluster:
  - `+ Inject Crisis` primary button — opens `<GlobalInjectModal>` prefilled.
  - Three stat pills: `Active runs: {N}`, `Last case: {relative time}`, `Latency p50: {Xs}`.
- Bottom edge: 4-lane micro-cascade (5% opacity) subtle USP reinforcement.

### Section B — Latest Investigation card

- Rendered only when cached run OR active stream exists for selected film+region.
- Header: `LATEST INVESTIGATION · {relative timestamp}` + status chip (`◉ approved` / `◉ pending` / `◉ streaming`).
- Report headline (display 2xl, from `report.headline`).
- Report tldr (body md, from `report.tldr`).
- Latency ribbon: `detection {det.latency_ms}ms · investigation {inv.latency_ms}ms · decision {dec.latency_ms}ms · {N} actions · ${impact} impact`.
- Recommended actions strip (3 cards horizontal): action_type, one-line rationale, impact, priority.
- Approve/Deny buttons if status `pending`.

### Section C — Agent Trace (persistent, 500-700px, always visible)

- Reuses `<AgentTrace>` with L6 bounded-scroll + auto-follow.
- Two modes selectable via tab bar in header:
  - `Cached (last run)` — replays events from cached triple via `runStore.replay(triple)`.
  - `Live` — active if stream in progress; disabled otherwise.
- Empty state (no cached run + no live): trace card still rendered with `No runs yet. Inject a crisis to see the pipeline.` centered.

### Section D — Run Timeline (~120px)

- Horizontal strip of past run tokens (dot + timestamp + severity color), oldest left, newest right, "Now" pinned right.
- Hover shows mini-preview. Click loads that run into B + C.
- Data source: `GET /catalog/films/:id/runs?limit=20`.

### Section E — Ambient telemetry (240px)

- Full-width chart: 30-day view of primary signal for selected region.
- Auto-selects widest-variance signal; markers on days with recorded detections (signal-family color).
- Data source: `GET /metrics/:film/:region`.

### Three-state rendering

- **Empty:** A + C + E. B replaced by cinematic empty card + particle animation.
- **Cached:** A + B + C (Cached mode) + D + E.
- **Live:** Same as Cached but B streams report fields; C flips to Live mode; live indicator in hero.

### Interactions

- Region selector change → re-fetches; React Query cache keyed by `film_id + region`.
- Inject submit → transitions to Live state; existing cached run demotes to "Previous" collapsed card above B.
- Trace row click → SQL/rationale Popover.

### Header

Hero (Section A) serves as page header. Breadcrumb in top bar shows `Movies / {film.title}`.

### Motion

- Section entrance: staggered top-down (A → B → C → D → E) at 60ms intervals.
- State transitions (Empty → Live, Cached → Live): full-page cross-fade, 200ms.
- Cached-mode replay: `traceRowEnter` used so it feels alive even from cache.

### A11y

- Region selector as native `<select>`.
- Trace tab bar uses `role="tablist"` with ARIA.
- Empty state announces via `aria-live="polite"`.
- Cached replay is user-triggered ("Replay from cache" button if not auto-playing).

---

## Section 7 — USP Treatment

**The claim being sold:** "We detect crises as the data lands in ClickHouse — median latency ~1 second from row insert to agent fire."

### 7.1 — Backend prerequisites

**Detection latency capture:**

- `backend/agents/detection.py` — on emit, compute `latency_ms = (detection_ts - signal_ts) * 1000` where `signal_ts` is the row's `ts` from source table. Add small SQL clause: `SELECT ..., ts AS signal_ts FROM ... ORDER BY ts DESC LIMIT 1`.
- Add `latency_ms: int` to `Detection` Pydantic model in `backend/api/contracts.py`. Propagate to SSE event.
- Frontend `api/contracts.ts` type gets the same field.
- Migration safety: `latency_ms` nullable; `<LatencyBadge>` renders `—` if null.

**`GET /intake/rates` (SSE):** `backend/api/routers/intake.py`

- Streams one event per second:
  ```json
  {"ts": "2026-08-16T12:34:56Z",
   "rates": {"box_office": 12483, "social": 3201, "reviews": 847, "streaming": 28940}}
  ```
- Rate = `SELECT count() FROM {table} WHERE ts >= now() - INTERVAL 5 SECOND` per table (4 queries unioned).
- Also publishes `detection.landed` events out-of-band:
  ```json
  {"ts": "...", "type": "detection.landed", "signal_family": "social", "film_id": "...", "region": "..."}
  ```
- Fallback: if CH unreachable, emits `{rates: null, error: "ch_unavailable"}`; strip renders last-known with `(cached)` label.

**`GET /stats/summary` (JSON, cache 5s):**

- Response:
  ```json
  {"crises_today": 14, "avg_latency_ms": 1240, "active_runs": 2, "as_of": "..."}
  ```
- Consumed by Landing Fold 4 (polled 5s).

### 7.2 — Surface 1: Landing hero particle cascade (decorative)

**Component:** `<ParticleCascade lanes={4} density={120} />` in `frontend/src/components/cascade.tsx`.

- Canvas 2D API, full-viewport absolute-positioned behind Fold 1 content.
- 4 vertical lanes at 15% / 38% / 62% / 85% viewport width. Each lane = stream of glowing particles drifting downward at 40-80px/s.
- Particle = 6px dot in signal-family color; box-shadow blur 8px same color. Fade in at y=0, fade out at y=viewport.
- `requestAnimationFrame` with delta-time; auto-throttles to 30fps on battery.
- **Not connected to real data.** Purely decorative.
- `prefers-reduced-motion`: cascade disables; static radial gradient in blue/pink/yellow/green replaces.

### 7.3 — Surface 2: Dashboard intake strip (functional)

**Component:** `<IntakeStrip />` in `frontend/src/panels/IntakeStrip.tsx`. Rendered as Row 1 of Dashboard.

- 4-column grid, each lane a `<Card>` variant.
- Per-lane:
  - Header: `<SignalChip signal="social" />` + label `SOCIAL_SENTIMENT`.
  - Rate: `{rate.toLocaleString()} rows/5s` (tabular-nums, text-2xl).
  - Micro-sparkline: last 30s in signal-family color, 40px tall.
- Subscribes to `/intake/rates` SSE via `signalStore.subscribeIntake()`.
- **Lane pulse (the USP moment):** on `detection.landed` for this family, animate `boxShadow` `0 0 0` → `0 0 24px {family_color}` over 200ms then back over 600ms; simultaneously fade in `⚡ DETECTED · {film.title}` chip in lane header for 3s.
- Fallback: SSE disconnect shows muted number with `paused` label; auto-reconnect exponential backoff.

### 7.4 — Surface 3: Latency badges (embedded)

**Component:** `<LatencyBadge ms={1400} />` in `frontend/src/components/LatencyBadge.tsx`.

- Rendered inline wherever a detection is displayed:
  - AnomalyFeed rows (Dashboard Section 4)
  - Movie card data variant (Movies Index Section 5)
  - Movie detail hero stat pills (Section 6.A)
  - Movie detail Latest Investigation ribbon (Section 6.B)
  - AgentTrace `detection.completed` step
- Visual: small monospace pill with lightning icon: `⚡ 1.4s`.
- Color by threshold:
  - Green: <2s (fast)
  - Amber: 2-5s (normal)
  - Red: >5s (slow — rare, indicates pipeline hiccup)
- Tooltip: `Detected {ms}ms after signal landed in ClickHouse.`
- Renders `—` if `latency_ms` is null.

### 7.5 — Supporting: Landing Fold 4 live counter

**Component:** `<LiveCounter />` in `frontend/src/panels/LiveCounter.tsx`. Only on Landing.

- Three big numbers side-by-side:
  - `{crises_today}` · `crises detected today`
  - `{(avg_latency_ms/1000).toFixed(1)}s` · `avg ingestion → detection`
  - `{active_runs}` · `active runs` (pulse dot if >0)
- Polls `/stats/summary` every 5s via React Query.
- Fallback: endpoint fail → ceremonial `Ready when you are.` line.

### 7.6 — Design tokens (signal-family palette elevated)

Add to `tailwind.config.js` / `frontend/src/styles/tokens.css`:

```
--signal-box-office: #4a9eff  (blue)
--signal-social:     #ff6b9d  (pink)
--signal-reviews:    #ffd93d  (yellow)
--signal-streaming:  #6bcf7f  (green)
```

Exposed as Tailwind utilities: `bg-signal-social`, `text-signal-reviews`, `border-signal-box-office`, `shadow-signal-streaming`. Used everywhere: chips, badges, cards, cascades, sparklines.

Amber (`#e8d4a0`) demoted to timestamp/chrome accent. Terracotta (`#c76d4e`) retained for CTA hover.

---

## Section 8 — Motion System, Cutover, Risks, Testing

### 8.1 — Motion system

**Tech:**

- **Framer Motion** — page transitions, panel entries, list staggers. Variants in `frontend/src/motion/choreography.ts`.
- **Canvas 2D API** — particle systems (landing cascade, movie detail hero micro-cascade). Custom loop in `frontend/src/motion/particleSystem.ts` (~200 LoC). No three.js.
- **CSS keyframes** — continuous ambient (intake pulse, live-run indicator, sparkline draw-in). Off main thread.

**New variants in `choreography.ts`:**

- `routeTransition` — cross-fade + y +8→0, 150ms enter / 100ms exit.
- `heroReveal` — opacity 0→1 + scale 0.98→1 + y +12→0, 300ms.
- `cardHoverGlow` — signal-family glow ring, 200ms.
- `intakePulse` — box-shadow 0 → 24px signal-family color → 0 over 800ms.
- `traceReveal` — enriched from L5 `traceRowEnter`; chain SQL block reveals after row (40ms stagger).

**Motion budget:** ≤4 concurrent Framer Motion animations at any moment. Cascade + intake pulses coexist because they're separate rendering paths.

**`prefers-reduced-motion` policy:**

- All Framer Motion variants respect via `useReducedMotion()`; degrade to instant.
- Canvas cascades disable; static radial gradient fallback.
- Sparkline draw-in becomes instant fill.
- Live counter still updates numerically, but numbers don't tween.

**Perf targets:**

- Landing hero: 60fps M1 Mac, 30fps mid-tier. Canvas throttles to 30fps on tab blur or low battery.
- Route transition p95 <200ms.
- Lighthouse Performance ≥80 on Landing (mobile emulation).

### 8.2 — Cutover strategy (phased)

**Phase 1 — Backend delta (12-16 hrs, days 1-3):**

1. Detection latency capture in `backend/agents/detection.py` (~2h).
2. `GET /intake/rates` SSE endpoint (~4h).
3. `GET /stats/summary` (~2h).
4. `GET /catalog/shelves`, `/catalog/films/:id`, `/catalog/films/:id/runs`, `/catalog/search` (~4h — reuse existing CH queries).
5. Backend redeploy + pytest contract tests (~2h).

**Wait for eval sweep to finish before Phase 1 begins.**

**Phase 2 — Foundation (16-20 hrs, days 4-7):**

1. Add `react-router-dom` + placeholder routes (~2h).
2. `<AppShell>` — left nav + top bar + `<GlobalInjectModal>` (~6h).
3. Signal-family tokens + `<SignalChip>` / `<LatencyBadge>` / `<RegionFlag>` primitives (~4h).
4. `catalogStore` + `signalStore` (Zustand) (~4h).
5. Playwright route-nav smoke (~2h).

**Phase 3 — Screens (60-70 hrs, days 8-18):**

1. Dashboard (rewire existing panels into new grid + intake strip + prefetch) — 14-18h.
2. Movies Index (shelves, cards, hero rotator) — 14-16h.
3. Movie Detail (hero + brief + persistent trace + timeline + telemetry) — 16-20h.
4. Landing (all 4 folds + cascade + live counter) — 20-24h. Built last (most fragile/polish-sensitive).

**Phase 4 — Polish + testing (8-10 hrs, days 19-21):**

1. Playwright e2e per route (~3h).
2. Motion tuning + reduced-motion QA (~2h).
3. Perf pass (Lighthouse, bundle analyzer) (~2h).
4. A11y pass (axe) (~2h).

**Phase 5 — Cutover + Devpost/video refresh (day 22, buffer to Sep 6):**

- Delete `OpsCenter.tsx`, `HistoryDrawer.tsx`, `HeroBanner.tsx`.
- Re-record demo video against new UI (rewrite `docs/superpowers/plans/video_beats.md`).
- Update Devpost writeup + screenshots.

### 8.3 — Telemetry bug (folded into Phase 3.1)

**Diagnose first, then fix.** Root-cause the empty-render before writing any patch. Three hypotheses to check in order:

- **H1 (verify first):** `/metrics/:film/:region` returns empty for eval-cache film+region combos. Verify with `curl https://scc-api-.../metrics/{sc_001_film_id}/{sc_001_region}` and inspect the response.
- **H2:** `min_ts` filter drops all rows if cached triple timestamps are older than the sparkline window. Verify by removing the filter and re-testing.
- **H3:** TelemetryStrip derived state in `runStore._recomputePanels()` doesn't re-render when `metrics[key]` populates. Verify with React DevTools; look for missing Zustand subscription on the `metrics` slice.

Whichever hypothesis is confirmed drives the fix. Fix lands as part of the `<TelemetryStrip>` refactor when it moves into the new Dashboard workspace. Playwright regression test locks the fix so it can't recur.

### 8.4 — Risk register

| Risk | Prob | Impact | Mitigation |
|---|---|---|---|
| Timeline slip (100-124h in 22 days) | Med | High | Phase 4 compressible. Landing Fold 4 counter is first cut candidate. |
| Canvas cascade tanks Lighthouse Perf | Med | Med | Particle count ≤120; auto-disable below observed 30fps; static gradient fallback. |
| Backend endpoints delay frontend | Low | High | Phase 1 front-loaded; nothing else starts until endpoints contract-tested + redeployed. |
| Eval sweep collision with backend redeploy | High (current) | Low | Wait for sweep to finish (~1h remaining) before Phase 1. Sweep idempotent; safe to re-run failures. |
| `data/eval_cache/` triples stale post-schema-change | Low | Med | Contract tests guard cached triples; `scripts/regenerate_fallback.py` tops up. |
| Motion overwhelm on judges' devices | Low | Med | `prefers-reduced-motion` respected globally; motion decorative; content works without. |
| Global Inject Modal breaks InjectControls tests | Low | Low | Deprecate `<InjectControls>` entirely; migrate tests to new modal. |

### 8.5 — Testing strategy

**Unit (Vitest):**

- Every new component: `<AppShell>`, `<IntakeStrip>`, `<LatencyBadge>`, `<SignalChip>`, `<MovieCard>`, `<LiveCounter>`, `<ParticleCascade>`, hero/brief/timeline for movie detail.
- Every new store slice: `catalogStore`, `signalStore`.
- Fallback rendering for each USP surface (endpoint-down states).

**Integration (Vitest + MSW):**

- Route mount → data hydration for each of `/dashboard`, `/movies`, `/movies/:id`, `/history`.
- SSE reconnect logic for `/intake/rates` and `/stream/investigation/:runId`.
- AnomalyFeed prefetch behavior (Section 4 amendment).

**E2E (Playwright):**

- `landing.spec.ts` — landing loads, cascade renders (or reduced-motion fallback), CTA routes to dashboard.
- `dashboard.spec.ts` — intake lanes visible, AnomalyFeed click flips Workspace to State B instantly.
- `movies.spec.ts` — shelves populate, card click opens detail with hero + trace.
- `movie-detail.spec.ts` — cached run replays trace, inject fires SSE, empty state correct.
- `keyboard.spec.ts` — ⌘K, I, Esc shortcuts.

**Contract (pytest):**

- `test_intake_endpoint.py` — SSE format, fallback on CH down.
- `test_stats_summary.py` — JSON shape, freshness.
- `test_catalog_endpoints.py` — shelves/films/search contracts.

**Perf:**

- Lighthouse CI in preflight. New budget: Landing Perf ≥80.

**A11y:**

- `axe-playwright` on each e2e spec.
- Manual reduced-motion + keyboard-only walkthrough before submission.

---

## Effort estimate

| Area | Hours |
|---|---|
| Landing (Q5·C + Q8·C) | 20-24 |
| Dashboard revamp (Q4·C) | 14-18 |
| Movies index (Q6·C) | 14-16 |
| Movie detail (Q7·C + persistent trace) | 16-20 |
| App shell + nav (Q3·A) | 6-8 |
| Motion system (Q8·C) | 16-20 |
| Backend endpoints delta | 8-10 |
| Telemetry fix + testing | 6-8 |
| **Total** | **~100-124 hrs** |

22 days to Sep 7, ~5 hrs/day sustained is feasible with focus. No buffer for backend churn — Phase 1 front-loading is critical.

---

## Plan structure

Single monolithic implementation plan (user decision, 2026-08-16), covering all phases 1-5 in one document. Tasks follow the phase order from §8.2 so that early phases produce working intermediates:

- **Phase 1** (Tasks 1-N) — Backend delta must complete + redeploy before Phase 2.
- **Phase 2** (Foundation) unlocks all screen work.
- **Phase 3** screen tasks (Dashboard → Movies → Movie Detail → Landing) can proceed serially.
- **Phase 4** (Polish + testing) after all screens land.
- **Phase 5** (Cutover + Devpost/video) as final tasks.

Frequent commit checkpoints at every phase boundary so the plan can be paused/resumed without losing progress.
