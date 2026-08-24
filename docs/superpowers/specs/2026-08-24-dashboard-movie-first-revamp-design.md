# Dashboard Revamp — Movie-First Analytics ("Ops-Room")

**Status:** Approved 2026-08-24
**Audience:** Film specialists / studio analysts (primary), engineers (secondary)
**Deadline pressure:** 22 days to Agentic Cinema Hackathon submission (Sep 7, 2026)

---

## 1. Design direction

The current dashboard is a **pipeline observability screen** that happens to be about a movie. This spec turns it into a **movie ops screen** that happens to have a pipeline. The pipeline / Live Agent Trace is engineering theater to the target user — it recedes into a right-edge drawer, closed by default.

### Aesthetic

Extend the existing visual language — do **not** replace it. Established tokens are kept:

- Dark cinema palette: `paper #0a0b10`, `card #151922`, `card-alt #1d2330`, `ink #f9f6f1`, `ink-soft #c0b7a8`, `accent #f14a67`, `line #3a4254`
- Signal-family accents: `box_office #63b7ff`, `social #ff80bb`, `reviews #ffd952`, `streaming #74db8d`
- Type: Inter (display + body), JetBrains Mono
- Motion: `motion.ease.cinematic = [0.16, 1, 0.3, 1]`, `duration.transition = 0.4`, `stagger = 0.09`

### The distinctive move

The **Region Heat Bar** — one horizontal band of 15 micro-tiles across the top of the workspace, one per canonical region, each rendering four vertical signal-family bars scaled to volume and delta-vs-baseline. At a glance an analyst reads 60 numbers (15 regions × 4 signals) as a single instrument panel. Click a tile → everything below re-scopes to that region.

---

## 2. Layout (desktop ≥1280w)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TOPBAR   ● Live Pipeline · US-EAST1     [Eval 21/30 ✓]   ⌘K  [Inject] │
├────────┬────────────────────────────────────────────────────────────────┤
│        │  ┌── MOVIE COMMAND ────────────────────────────────────────┐  │
│  NAV   │  │  ┌──────┐  Spider-Man: Brand New Day       [Film ▾]    │  │
│        │  │  │POSTER│  Marvel · 128m · English · ★7.8              │  │
│ ● Dash │  │  │      │  Budget $260M · Box $840M                     │  │
│ ▢ Movs │  │  └──────┘  ─────────────────────────────────────────    │  │
│ ▢ Next │  │  REGION HEAT · 15 markets                               │  │
│        │  │  NAM|LAM|UKI|EUW|EUE|NOR|IND|SEA|KOR|JPN|CHN|MEA|AFR|.. │  │
│        │  │  ▓░▓|░░░|▓▓▓|░▓░|▓░░|░░▓|░░░|▓░▓|▓▓▓|░▓░|░░▓|▓▓▓|▓░░|.. │  │
│        │  │  (4 signal-family bars per cell, click to scope)         │  │
│        │  └───────────────────────────────────────────────────────── │  │
│        │                                                                │
│        │  ┌── INVESTIGATION REPORT ─────────────────────┐  ┌─ TRACE ─┐ │
│        │  │  Detection · Spider-Man · Brazil            │  │ hidden  │ │
│        │  │  Metric social_trends.avg_sentiment          │  │ by      │ │
│        │  │  Baseline −6.34 → actual −9.75              │  │ default │ │
│        │  │  Numeric / Text / Categorical / Temporal    │  │         │ │
│        │  │  Synthesis · Recommendation · Approval      │  │ ▸ Show  │ │
│        │  └────────────────────────────────────────────┘  └─────────┘ │
│        │                                                                │
│        │  ┌── TIMESERIES · Brazil ────────────────────────────────┐    │
│        │  │  ▁▂▄█▃▂  ▂▄█▃▁    ▂▁▃▅▂     ▄▂▁▂▃                    │    │
│        │  │  Box     Social    Sentiment  Trailer                  │    │
│        │  └──────────────────────────────────────────────────────  │    │
├────────┴────────────────────────────────────────────────────────────────┤
│  ● 3 RUNS · Brazil ● / Japan ○ / Korea ○     ⓘ                          │
└─────────────────────────────────────────────────────────────────────────┘
   (Pipeline Ticker only visible when ≥1 run is in flight)
```

---

## 3. Component inventory

### New

| Component | Responsibility |
|---|---|
| `<MovieCommand>` | Header card: poster + meta + `<FilmPicker>` + Region Heat Bar |
| `<RegionHeatBar>` | 15-tile horizontal grid, driven by `/metrics/{film_id}/regions` |
| `<RegionTile>` | One tile: 4 signal-family bars + code + open-investigation pin + active-run pulse |
| `<FilmPicker>` | Command-K style typeahead in `<MovieCommand>` header |
| `<TimeseriesGrid>` | 4-up sparkline grid scoped to `selectedFilmId × selectedRegion` |
| `<PipelineTicker>` | Bottom-docked strip: run count + per-run stage dots (only visible when active) |
| `<TraceDrawer>` | Right-edge slide-out wrapping existing `<AgentTrace>` — closed by default |
| `<MultiRegionPicker>` | Multi-select chip picker inside Inject modal (defaults to current region + "All 15" quick button) |

### Modified

| Component | Change |
|---|---|
| `runStore` | Add `selectedFilmId`, `selectedRegion`, `activeRuns`, `focusedRunId`, `pickFilm()`, `pickRegion()`, `focusRun()` (all persisted) |
| `DashboardRoute` | Replace 3-col grid with MovieCommand → InvestigationReport (Trace drawer edge) → TimeseriesGrid; PipelineTicker anchors bottom |
| `MovieCard` (Movies index) | Add 3-region signal mini-strip under poster; crimson pin if any open investigation; hover expands strip to 6 regions |
| `MovieHero` (Movie Detail) | Reuse `<RegionHeatBar>` in place of the 4-panel global row-total block |
| `InjectModal` | Region field becomes `<MultiRegionPicker>` |

### Removed / demoted

| Component | Fate |
|---|---|
| `<IntakeStrip>` (global row totals) | Removed from dashboard (still importable elsewhere if needed) |
| `<AnomalyFeed>` (left rail) | Folded into PipelineTicker as an expandable pop-over |
| `<RecentRuns>` (left rail) | Moves to Movie Detail (already scoped there today) |
| `<AgentTrace>` (right rail permanent) | Moved into `<TraceDrawer>`, hidden by default |

---

## 4. Region Heat Bar spec

### Data source (NEW endpoint)

`GET /metrics/{film_id}/regions?hours=168`

```json
{
  "film_id": 1,
  "hours": 168,
  "regions": [
    {
      "code": "Brazil",
      "signals": {
        "box_office": { "volume": 12400, "delta_pct": -18.2, "anomaly": true },
        "social":     { "volume": 84000, "delta_pct": -34.7, "anomaly": true },
        "reviews":    { "volume":  2100, "delta_pct":  -4.1, "anomaly": false },
        "streaming":  { "volume": 51000, "delta_pct":  -8.9, "anomaly": false }
      },
      "open_investigation": true
    }
    // … 14 more regions, one per canonical code
  ],
  "query_latency_ms": 87
}
```

Backend query: one ClickHouse round-trip per rollup table with `GROUP BY region`, then merged in Python. Budget: 50-150ms. Uses same rollup tables as existing `/metrics/{film_id}/{region}`.

### Tile visual (48px × 72px)

- **Top:** 3-char region code, `font-mono text-[10px] uppercase tracking-wider text-ink-soft` (7-char codes truncated with the canonical 3-char mapping)
- **Body:** 4 vertical bars, gap-[2px], each 8px wide
  - Height: `Math.max(4, normalizedVolume * 48)`px
  - Fill: signal family `hex` at opacity `anomaly ? 1.0 : 0.6`
  - Ring: `anomaly ? '1px solid var(--sig-family)' : none`
- **Top-right corner:** 6×6 crimson dot if `open_investigation`
- **Active-run pulse:** if this region is in `activeRuns`, wrap tile in an `animate-pulse` crimson ring
- **Hover:** `translate-y: -2px`, background lifts to `bg-card-alt`, tooltip shows raw numbers per signal family
- **Selected:** 1px crimson border, background stays lifted

### Motion

- On mount / film change: cells cascade in `y: 8→0, opacity: 0→1`, `delay: i * 0.025`, `duration: 0.35`, easing `cinematic`
- On region click: crimson radial pulse on selected tile (400ms)
- Reduced-motion: swap the cascade for a single 200ms fade

### Empty-data regions

Render the tile with bars at height 4px, opacity 0.15, code muted. **Do not hide** — the 15-region invariant is a design contract.

### Canonical 15 regions

`NA` (North America), `LATAM`, `UK`, `EU-West`, `EU-East`, `Nordics`, `India`, `SEA`, `Korea`, `Japan`, `China`, `MENA`, `Africa`, `ANZ`, `Brazil`.

The 3-char code map lives in `frontend/src/lib/regions.ts` (extend existing helper).

---

## 5. Movie Command header spec

- **Left:** 96×144 poster, 1px `border-line`, hover lifts +2px
- **Center:** title (`font-display text-2xl font-bold tracking-tight`), meta row (genre · runtime · language · rating · budget · box office as inline `MetaChip`s)
- **Right:** `<FilmPicker>` — command-K style dropdown showing recent films + typeahead search against `/catalog/search`; Enter or click sets `selectedFilmId` and prefetches metrics
- **Below meta:** horizontal `border-line` divider, then Region Heat Bar

---

## 6. Investigation Report + Trace Drawer

- Existing `<DashboardWorkspace>` (Investigation / Recommendation / Approval tabs) is retained. Two behavior changes:
  1. **Detection banner** derives its title/region from the currently *selected* film×region context, not just the last run
  2. When `selectedFilmId × selectedRegion` matches `focusedRunId`'s film × region → show live report from store; otherwise call `GET /films/{id}/latest-investigation?region={code}` and show that
- Right edge sports a persistent 24px-wide **trace tab rail** — vertical text `AGENT TRACE ▸`, crimson glow if any active run is streaming. Click → drawer slides in from right (`x: 100% → 0`, `duration: 0.35`, `easing: cinematic`), overlays the timeseries grid, backdrop dims to `rgba(0,0,0,0.4)`. Esc / backdrop-click closes.

Preserves pipeline visibility for engineers/demo while decluttering the analyst view.

---

## 7. Pipeline Ticker (bottom-docked, conditional)

Visible when `activeRuns` is non-empty or any run completed in the last 30s.

**Single run:**
`● PIPELINE ACTIVE · run_ab12 · 2394ms   ● Detection ● Investigation ○ Decision ○ Report`

**Multi run:**
`● 3 RUNS · Brazil ●●●○  / Japan ●●○○  / Korea ●○○○     [ⓘ expand]`

- Height 48px, `bg-card` with top border-line
- Slides up from bottom on first activation (`y: 100% → 0`), slides down 30s after all runs completed
- Stage dots: filled = complete, hollow ring = in progress, empty ring = pending — crimson (accent) on completion
- Per-run name click → sets `focusedRunId` (drives which Investigation Report is shown)
- Expand caret → pops open a compact list of all runs with metric + region + latency

---

## 8. Movies Index card enhancement

Existing `<MovieCard>` gets a new 3-cell strip under the poster:

```
┌────────────┐
│   POSTER   │
├────────────┤
│  Title     │
│  meta line │
├────────────┤
│ BRA NAM JPN│  ← top 3 regions by 168h combined signal volume
│  ▲   ▼   ─│  ← ▲ green +Δ, ▼ crimson −Δ, ─ neutral
└────────────┘
```

- Crimson pin badge in card top-right if any region has an open investigation
- Hover: strip expands to 6 regions (animated width, 200ms)
- Click a strip cell → routes to `/dashboard` with `?film={id}&region={code}` (store hydrates on mount)

Data source: extend `/catalog/shelves` payload with `top_regions: [{ code, delta_pct }]` (up to 6 per film) — cheaper than fetching the full 15-region matrix for every card.

---

## 9. Multi-region injection

### Backend delta

`POST /inject-crisis` — accept **either**:

```json
{ "ctype": "regional_sentiment_collapse", "film_id": 1, "region": "Brazil", "magnitude": 0.5 }
```

**or**

```json
{ "ctype": "regional_sentiment_collapse", "film_id": 1, "regions": ["Brazil", "Japan", "Korea"], "magnitude": 0.5 }
```

- If `regions` provided (non-empty list), fire N independent pipelines via `asyncio.gather`. Each gets its own `run_id`.
- Return `{ run_ids: ["r_abc", "r_def", "r_ghi"] }` (single-region calls return `{ run_id: "r_abc" }` for backward compat).
- Validate: `regions` length ≤ 15 (all canonical) to prevent runaway fan-out.
- Ground-truth recording per-region (existing recorder is per-run, so no change there).

### Frontend delta

**Inject modal:** current region `<select>` becomes `<MultiRegionPicker>`:

```
Regions  [Brazil ×] [Japan ×] [Korea ×]  + Add region ▾    [ All 15 ]
```

- Defaults: current `selectedRegion` if set, else empty
- Quick "All 15" button fills with all canonical codes
- Submit → POST with `regions: [...]` if length ≥ 2, else `region: ...` for backward compat

**Store shape:**

```ts
activeRuns: Record<runId, {
  filmId: number
  region: string
  streamState: 'connecting' | 'streaming' | 'closed' | 'error'
  events: SseEvent[]
  detection: DetectionRow | null
  findings: Finding[]
  decision: DecisionResult | null
  report: ExecutiveReport | null
  startedAt: number
}>
focusedRunId: string | null   // which run drives the visible Investigation Report
```

- Existing single-run selectors (`runStore.detection`, `runStore.report`, etc.) become derived from `activeRuns[focusedRunId]` for backward compat
- Each active run opens its own SSE stream
- On any `pipeline.completed` event, that run's data stays in `activeRuns` (not deleted) so the analyst can navigate back to it via the ticker

**Region Heat Bar:** tiles for regions in `activeRuns` get a crimson pulse ring (already speced in §4).

**PipelineTicker:** multi-run rendering already speced in §7.

---

## 10. State delta (Zustand)

`runStore` additions:

```ts
selectedFilmId: number | null
selectedRegion: string | null     // null = "All markets" (heat bar visible, timeseries hidden)
activeRuns: Record<string, RunState>
focusedRunId: string | null

pickFilm: (id: number) => void    // sets film, clears region, prefetches /metrics/{id}/regions
pickRegion: (code: string | null) => void  // sets region, prefetches /metrics/{id}/{code} and /films/{id}/latest-investigation?region={code}
focusRun: (runId: string) => void // sets focusedRunId, no fetch
inject: (opts: { ctype, filmId, regions: string[], magnitude }) => Promise<string[]>  // returns array of run_ids
```

Persist: `selectedFilmId`, `selectedRegion`, `focusedRunId`, `activeRuns` (excluding stream close functions).

**Routing hydration:**
- `/dashboard?film=1&region=Brazil` → on mount, `pickFilm(1)` then `pickRegion('Brazil')`
- Movies card click → `pickFilm(id)` then `navigate('/dashboard')`
- Movie Detail region tile click → `pickFilm(id)` + `pickRegion(code)` + `navigate('/dashboard')`

---

## 11. Backend delta summary

| Endpoint | Change | Reason |
|---|---|---|
| `GET /metrics/{film_id}/regions?hours=168` | **NEW** | Powers `<RegionHeatBar>` |
| `GET /catalog/shelves` | Add `top_regions[]` per film | Powers Movies index mini-strip |
| `GET /films/{film_id}/latest-investigation` | Add optional `?region=` query param | Powers Investigation panel when region changes on dashboard |
| `POST /inject-crisis` | Accept optional `regions: [str]` (list), return `run_ids: []` | Multi-region injection |

Contract tests (pytest) required for all four endpoints in the same commit as backend code.

---

## 12. Motion palette (unchanged)

Reuse existing tokens — do not introduce new easings or durations. Consistency between MovieCommand cascade, Trace Drawer slide, PipelineTicker rise, and multi-region tile pulses is what makes the room feel unified.

---

## 13. Rough sequencing (informs the plan)

| # | Phase | Est |
|---|---|---|
| 1 | Backend: `/metrics/{id}/regions`, `top_regions` in shelves, `region` filter on latest-investigation, multi-region inject | 1 day |
| 2 | Store: `selectedFilmId`/`selectedRegion`/`activeRuns`/`focusedRunId` + routing hydration | 0.5 day |
| 3 | `<RegionHeatBar>` + `<RegionTile>` + data flow | 1 day |
| 4 | `<MovieCommand>` header + `<FilmPicker>` | 0.5 day |
| 5 | `<MultiRegionPicker>` + inject modal rework + multi-stream store logic | 1 day |
| 6 | `<DashboardRoute>` recomposition + `<TraceDrawer>` + `<PipelineTicker>` | 1 day |
| 7 | Movies card region mini-strip + open-investigation pin | 0.5 day |
| 8 | Reduced-motion QA, keyboard nav, Lighthouse pass | 0.5 day |

**Total: ~6 days.** Safe inside the 22-day buffer.

---

## 14. Out of scope (explicit YAGNI)

- Cross-film comparison view (multi-film heat matrix) — deferred to post-hackathon
- Historical playback of past crises across regions — deferred
- Region-level custom crisis magnitudes (all regions in a batch use the same magnitude for v1)
- Region-tile drag-to-reorder — no, canonical order is stable
- Trace Drawer as a resizable panel — no, fixed 480px width
- Bulk approval across multiple runs in one action — no, per-run approval preserves audit trail
