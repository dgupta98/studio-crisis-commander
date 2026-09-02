import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  SseEvent, DetectionRow, Finding, DecisionResult, ExecutiveReport,
  ApprovalStatus, AuditRow, MetricsResponse, CrisisType,
} from '@/api/contracts'
import { apiGet, apiPost } from '@/api/client'
import { openStream } from '@/api/sse'
import { queryClient } from '@/api/queryClient'
import { seedFromCachedTriple, type CachedTriple } from '@/lib/demoSeed'

export type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; substatus?: string }
  | { kind: 'success' }
  | { kind: 'empty'; hint?: string }
  | { kind: 'error'; message: string; retry?: () => void }

type PanelKey =
  | 'hero' | 'telemetry' | 'anomaly' | 'trace'
  | 'recommendation' | 'approval' | 'history'

// Wire shape returned by GET /catalog/films/{film_id}/runs/{decision_id}.
// Detection is partial (only film_id/region/metric/magnitude/severity are
// stored on the audit + detections join); findings/hypothesis aren't
// persisted at all, so the trace will show pipeline/detection/decision/
// report events only when a past run is replayed.
export interface PastRunDetail {
  scenario_id: string
  detection: {
    film_id: number
    region: string
    metric: string | null
    severity: string | null
    magnitude: number | null
    latency_ms: number | null
  }
  agent_run: DecisionResult
  report: ExecutiveReport | null
  approval_status: ApprovalStatus
  created_at: string
}

export interface ActiveRunState {
  filmId: number | null
  region: string | null
  streamState: 'connecting' | 'streaming' | 'closed' | 'error'
  startedAt: number
  // Per-run pipeline state. Kept here so multi-region injects don't
  // clobber each other's events into a single global bucket — clicking a
  // region pill flips focusedRunId and the trace panel projects the
  // matching bucket onto the top-level singletons.
  events: SseEvent[]
  detection: DetectionRow | null
  findings: Finding[]
  decision: DecisionResult | null
  report: ExecutiveReport | null
  approvalStatus: ApprovalStatus | null
  mode: 'live' | 'fallback' | null
}

interface RunStore {
  // ─── data ────────────────────────────────────────
  runId: string | null
  // Film targeted by the current run. Set at inject() time so Movie Detail
  // can scope its Agent Trace immediately — without waiting for the
  // detection.completed event to populate `detection`. Persists so a
  // refresh mid-run keeps the trace on the correct movie's page.
  currentRunFilmId: number | null
  events: SseEvent[]
  detection: DetectionRow | null
  findings: Finding[]
  decision: DecisionResult | null
  report: ExecutiveReport | null
  approvalStatus: ApprovalStatus | null
  mode: 'live' | 'fallback' | null
  recentDetections: DetectionRow[]
  auditRows: AuditRow[]
  // Keyed by `${filmId}:${region}` (raw, unencoded). URL uses encodeURIComponent
  // on region separately; do not use the encoded form for lookups.
  metrics: Record<string, MetricsResponse>
  // ─── multi-run tracking ───────────────────────────────
  // Every triggered inject registers here. `focusedRunId` picks which one
  // drives the visible Investigation Report and single-run selectors.
  activeRuns: Record<string, ActiveRunState>
  focusedRunId: string | null
  latencyMs: number | null

  // ─── selection ────────────────────────────────────────
  selectedFilmId: number | null
  selectedRegion: string | null

  // ─── stream ──────────────────────────────────────
  streamState: 'idle' | 'connecting' | 'streaming' | 'closed' | 'error'
  apiReachable: boolean
  panelStates: Record<PanelKey, PanelState>
  _closeStream: (() => void) | null

  // ─── actions ─────────────────────────────────────
  inject: (opts?: {
    crisisType?: CrisisType
    filmId?: number
    region?: string
    regions?: string[]
    magnitude?: number
    fallback?: 'force'
  }) => Promise<string[]>
  connectStream: (runId: string) => void
  approve: (decisionId: string, note?: string) => Promise<void>
  deny: (decisionId: string, reason: string) => Promise<void>
  loadDetections: (limit?: number) => Promise<void>
  loadAudit: (limit?: number) => Promise<void>
  loadMetrics: (filmId: number, region: string, hours?: number) => Promise<void>
  seedFromCached: (scenarioId?: string) => Promise<boolean>
  pickFilm: (id: number | null) => void
  pickRegion: (code: string | null) => void
  focusRun: (runId: string) => void
  selectPastRun: (data: PastRunDetail) => void
  _registerRun: (runId: string, opts: { filmId: number | null; region: string | null }) => void
  _updateRunStream: (runId: string, streamState: ActiveRunState['streamState']) => void
  reset: () => void
  _dispatch: (runId: string, ev: SseEvent) => void
  _recomputePanels: () => void
}

const INITIAL_PANELS: Record<PanelKey, PanelState> = {
  hero: { kind: 'idle' },
  telemetry: { kind: 'idle' },
  anomaly: { kind: 'empty', hint: 'Loading recent detections…' },
  trace: { kind: 'idle' },
  recommendation: { kind: 'idle' },
  approval: { kind: 'idle' },
  history: { kind: 'idle' },
}

const INITIAL: Omit<RunStore, keyof {
  inject: never; connectStream: never; approve: never; deny: never;
  loadDetections: never; loadAudit: never; loadMetrics: never;
  seedFromCached: never; reset: never;
  pickFilm: never; pickRegion: never;
  focusRun: never; selectPastRun: never;
  _registerRun: never; _updateRunStream: never;
  _dispatch: never; _recomputePanels: never;
}> = {
  runId: null,
  currentRunFilmId: null,
  events: [],
  detection: null,
  findings: [],
  decision: null,
  report: null,
  approvalStatus: null,
  mode: null,
  recentDetections: [],
  auditRows: [],
  metrics: {},
  activeRuns: {},
  focusedRunId: null,
  latencyMs: null,
  selectedFilmId: null,
  selectedRegion: null,
  streamState: 'idle',
  apiReachable: true,
  panelStates: INITIAL_PANELS,
  _closeStream: null,
}

export const useRunStore = create<RunStore>()(
  persist(
    (set, _get) => ({
  ...INITIAL,

  inject: async (opts) => {
    const body: Record<string, unknown> = {}
    if (opts?.crisisType) body.ctype = opts.crisisType
    if (opts?.filmId !== undefined) body.film_id = opts.filmId
    if (opts?.regions && opts.regions.length > 0) body.regions = opts.regions
    else if (opts?.region) body.region = opts.region
    if (opts?.magnitude !== undefined) body.magnitude = opts.magnitude
    if (opts?.fallback) body.fallback = opts.fallback

    // Clear prior single-run residue so the visible panels reset. The
    // multi-run activeRuns map is additive — completed runs stay accessible
    // via the pipeline ticker until reset() or refresh.
    set({
      runId: null,
      currentRunFilmId: opts?.filmId ?? null,
      events: [],
      detection: null,
      findings: [],
      decision: null,
      report: null,
      approvalStatus: null,
      mode: null,
    })

    // Multi-region path: server returns run_ids[]; we register + connect all.
    if (opts?.regions && opts.regions.length > 0) {
      const res = await apiPost<{ run_ids: string[]; stream_urls?: string[] }>(
        '/inject-crisis', body,
      )
      const runIds = res.run_ids ?? []
      runIds.forEach((rid, i) => {
        useRunStore.getState()._registerRun(rid, {
          filmId: opts.filmId ?? null,
          region: opts.regions?.[i] ?? null,
        })
        useRunStore.getState().connectStream(rid)
      })
      if (runIds[0]) {
        // Focus the first run so its detection/report drive the workspace.
        // focusRun projects that run's (initially empty) per-run bucket onto
        // top-level fields; subsequent _dispatch calls for the focused run
        // mirror through, and pill-clicks re-project the target run.
        set({ runId: runIds[0], streamState: 'connecting' })
        useRunStore.getState().focusRun(runIds[0])
      }
      useRunStore.getState()._recomputePanels()
      return runIds
    }

    // Single-region path (backward compat with existing callers).
    const res = await apiPost<{ run_id: string; stream_url?: string }>(
      '/inject-crisis', body,
    )
    const runId = res.run_id
    set({ runId, streamState: 'connecting' })
    useRunStore.getState()._registerRun(runId, {
      filmId: opts?.filmId ?? null,
      region: opts?.region ?? null,
    })
    useRunStore.getState().focusRun(runId)
    useRunStore.getState().connectStream(runId)
    useRunStore.getState()._recomputePanels()
    return [runId]
  },

  connectStream: (runId: string) => {
    const prev = useRunStore.getState()._closeStream
    set({ _closeStream: null })  // clear before invoking so a sync openStream throw can't leave a stale ref
    prev?.()
    const close = openStream(
      runId,
      // Tag every SSE with its runId so _dispatch can route into the correct
      // per-run bucket in activeRuns — without this, multi-region injects
      // merge all events into one array and the last run wins.
      (payload) => useRunStore.getState()._dispatch(runId, payload as SseEvent),
      (_err) => {
        useRunStore.getState()._updateRunStream(runId, 'error')
        if (useRunStore.getState().focusedRunId === runId) {
          set({ streamState: 'error' })
        }
        useRunStore.getState()._recomputePanels()
      },
    )
    useRunStore.getState()._updateRunStream(runId, 'connecting')
    if (useRunStore.getState().focusedRunId === runId) {
      set({ streamState: 'connecting' })
    }
    set({ _closeStream: close })
    useRunStore.getState()._recomputePanels()
  },

  approve: async (decisionId, note) => {
    const res = await apiPost<{ approval_status: ApprovalStatus }>(
      `/approve/${decisionId}`,
      { approver: 'dashboard@demo', note: note ?? '' },
    )
    set({ approvalStatus: res.approval_status })
  },

  deny: async (decisionId, reason) => {
    const res = await apiPost<{ approval_status: ApprovalStatus }>(
      `/deny/${decisionId}`,
      { denier: 'dashboard@demo', reason },
    )
    set({ approvalStatus: res.approval_status })
  },

  loadDetections: async (limit = 20) => {
    try {
      const res = await apiGet<{ detections: DetectionRow[] }>(
        `/detections?limit=${limit}`,
      )
      set({ recentDetections: res.detections, apiReachable: true })
    } catch (e) {
      if (e instanceof Error) {
        set({ apiReachable: false })
      } else { throw e }
    } finally {
      useRunStore.getState()._recomputePanels()
    }
  },

  loadAudit: async (limit = 20) => {
    try {
      const res = await apiGet<{ rows: AuditRow[] } | AuditRow[]>(`/audit?limit=${limit}`)
      const rows = Array.isArray(res) ? res : res.rows
      set({ auditRows: rows, apiReachable: true })
    } catch (e) {
      if (e instanceof Error) console.error('[loadAudit]', e)
      set({ apiReachable: false })
    }
    useRunStore.getState()._recomputePanels()
  },

  // 168h (7d) not 48h — many (film, region) pairs have only 2-3 rollup
  // points inside 48h and the sparklines rendered as invisible flat lines.
  // The backend anchors each window at max(ts) of the underlying table so
  // widening doesn't move us off the data — it just captures more of it.
  loadMetrics: async (filmId, region, hours = 168) => {
    try {
      const res = await apiGet<MetricsResponse>(
        `/metrics/${filmId}/${encodeURIComponent(region)}?hours=${hours}`,
      )
      // See RunStore.metrics for the canonical key format.
      const key = `${filmId}:${region}`
      set((s) => ({
        metrics: { ...s.metrics, [key]: res },
        latencyMs: res.query_latency_ms,
        apiReachable: true,
      }))
    } catch {
      set({ apiReachable: false })
    }
    useRunStore.getState()._recomputePanels()
  },

  seedFromCached: async (scenarioId = 'sc_001') => {
    // Hydrate the store from a bundled cached triple so the dashboard shows
    // a fully-worked example on first load — a judge landing cold sees the
    // trace / investigation / recommendation immediately, and can inject a
    // fresh crisis on top when they want to watch the live pipeline.
    try {
      const triple = await apiGet<CachedTriple>(`/eval_cache/${scenarioId}.json`)
      const seed = seedFromCachedTriple(triple)
      set({
        runId: seed.runId,
        currentRunFilmId: seed.currentRunFilmId,
        events: seed.events,
        detection: seed.detection,
        findings: seed.findings,
        decision: seed.decision,
        report: seed.report,
        approvalStatus: seed.decision.status,
        mode: 'fallback',
        streamState: 'closed',
      })
      useRunStore.getState()._recomputePanels()
      return true
    } catch {
      return false
    }
  },

  pickFilm: (id) => {
    // Clear region when the film changes — the region context resets to
    // "All markets" until the analyst re-picks. Prefetching /metrics/regions
    // happens in the component (see MovieCommand.tsx) so this stays pure.
    set({ selectedFilmId: id, selectedRegion: null })
  },

  pickRegion: (code) => {
    set({ selectedRegion: code })
  },

  focusRun: (runId) => {
    const s = useRunStore.getState()
    const run = s.activeRuns[runId]
    if (!run) return
    // Project the run's per-run bucket onto the top-level singletons so
    // every existing selector (AgentTrace, DashboardWorkspace, MovieDetail,
    // LatestInvestigation, etc.) sees the newly focused run without any
    // per-consumer rewiring.
    //
    // `?? []` / `?? null` guards heal persisted entries from before the
    // multi-run refactor — those buckets lack the new event/detection
    // fields, and projecting undefined onto top-level crashes AgentTrace's
    // `for (const e of events)` on the next render.
    set({
      focusedRunId: runId,
      runId,
      currentRunFilmId: run.filmId ?? null,
      events: run.events ?? [],
      detection: run.detection ?? null,
      findings: run.findings ?? [],
      decision: run.decision ?? null,
      report: run.report ?? null,
      approvalStatus: run.approvalStatus ?? null,
      mode: run.mode ?? null,
      streamState: run.streamState ?? 'closed',
    })
    useRunStore.getState()._recomputePanels()
  },

  selectPastRun: (data) => {
    // Hydrate the top-level singletons from a persisted audit row so the
    // Investigation / Recommendation / Approval / Agent Trace panels all
    // render with THAT run's payload — not the demo cached sample.
    //
    // focusedRunId is cleared so any parallel live SSE (from an inject that
    // fires while a past run is displayed) won't mirror its events onto our
    // top-level state and clobber the replay. The user must trigger a new
    // inject (which calls focusRun) to switch back to live view.
    const det = data.detection
    const sevNum = det.severity ? Number(det.severity) : 0
    const detectionRow: DetectionRow = {
      metric_ts: data.created_at,
      metric: det.metric ?? '',
      film_id: det.film_id,
      region: det.region,
      detector: '',
      baseline_value: 0,
      actual_value: 0,
      magnitude: det.magnitude ?? 0,
      business_impact: 0,
      severity: Number.isFinite(sevNum) ? sevNum : 0,
      dedup_key: '',
      latency_ms: det.latency_ms,
    }

    // Synthesize a minimal SSE trace so AgentTrace has something to render.
    // Findings/hypothesis aren't persisted — those event types are omitted.
    const ts = data.created_at || new Date().toISOString()
    const runId = `past:${data.scenario_id}`
    let seq = 0
    const mode = 'fallback' as const
    const push = (type: string, d: Record<string, unknown>): SseEvent => ({
      seq: seq++, ts, type, data: { ...d, mode },
    })
    const events: SseEvent[] = [
      push('pipeline.started', { run_id: runId, mode }),
      push('detection.completed', { detection: detectionRow, source: 'audit' }),
      push('investigation.started', {}),
      push('investigation.completed', { investigation: null }),
      push('decision.started', {}),
      ...data.agent_run.actions.flatMap((a, i) => [
        push('action.proposed', {
          action_index: i,
          action_type: a.action_type,
          params: a.params,
          priority: a.priority,
          rationale: a.rationale,
        }),
        push('action.impact_computed', {
          action_index: i,
          action_type: a.action_type,
          impact_usd: a.impact_usd,
          impact_error: a.impact_error,
        }),
      ]),
      push('decision.completed', {
        decision: data.agent_run,
        status: data.agent_run.status,
        threshold_usd: data.agent_run.threshold_usd,
      }),
      push('report.started', {}),
      ...(data.report ? [push('report.completed', { report: data.report })] : []),
      push('pipeline.completed', { run_id: runId, latency_ms: 0, mode }),
    ]

    set({
      runId: data.scenario_id,
      currentRunFilmId: data.detection.film_id,
      events,
      detection: detectionRow,
      findings: [],
      decision: data.agent_run,
      report: data.report,
      approvalStatus: data.approval_status,
      mode: 'fallback',
      streamState: 'closed',
      focusedRunId: null,
    })
    useRunStore.getState()._recomputePanels()
  },

  _registerRun: (runId, opts) => {
    const s = useRunStore.getState()
    const entry: ActiveRunState = {
      filmId: opts.filmId ?? null,
      region: opts.region ?? null,
      streamState: 'connecting',
      startedAt: Date.now(),
      events: [],
      detection: null,
      findings: [],
      decision: null,
      report: null,
      approvalStatus: null,
      mode: null,
    }
    const nextFocused = s.focusedRunId ?? runId
    set({
      activeRuns: { ...s.activeRuns, [runId]: entry },
      focusedRunId: nextFocused,
    })
  },

  _updateRunStream: (runId, streamState) => {
    const s = useRunStore.getState()
    if (!s.activeRuns[runId]) return
    set({
      activeRuns: {
        ...s.activeRuns,
        [runId]: { ...s.activeRuns[runId], streamState },
      },
    })
  },

  reset: () => {
    const { _closeStream } = useRunStore.getState()
    set({ ...INITIAL })
    _closeStream?.()
  },

  _dispatch: (runId, ev) => {
    const s = useRunStore.getState()
    const rawRun = s.activeRuns[runId]
    if (!rawRun) return  // stray SSE for a run we don't track — drop
    // Heal persisted entries from before the multi-run refactor so
    // `.some(...)`, `[...run.events, ...]`, and `[...run.findings, ...]`
    // can't crash on undefined arrays mid-dispatch.
    const run: ActiveRunState = {
      ...rawRun,
      events: rawRun.events ?? [],
      findings: rawRun.findings ?? [],
    }

    // Dedupe by seq PER RUN — server replays on reconnect (Layer 4 §6).
    if (run.events.some((e) => e.seq === ev.seq)) return

    // Build the per-run patch first, then decide what to mirror to
    // top-level singletons based on focus.
    const runPatch: Partial<ActiveRunState> = { events: [...run.events, ev] }
    if (run.streamState === 'connecting') {
      runPatch.streamState = 'streaming'
    }
    if (!run.mode && (ev.data as { mode?: 'live' | 'fallback' })?.mode) {
      runPatch.mode = (ev.data as { mode?: 'live' | 'fallback' }).mode ?? null
    }

    switch (ev.type) {
      case 'detection.completed': {
        const d = (ev.data as { detection?: DetectionRow }).detection
        if (d) {
          runPatch.detection = d
          // fire-and-forget metrics fetch for the affected film/region
          void useRunStore.getState().loadMetrics(d.film_id, d.region)
        }
        break
      }
      case 'signal.completed': {
        const f = (ev.data as { finding?: Finding }).finding
        if (f) runPatch.findings = [...run.findings, f]
        break
      }
      case 'action.impact_computed': {
        // merge impact into the matching action of THIS run's decision
        const p = ev.data as { action_index?: number; impact_usd?: number }
        if (run.decision && typeof p.action_index === 'number') {
          const actions = run.decision.actions.map((a, i) =>
            i === p.action_index ? { ...a, impact_usd: p.impact_usd ?? a.impact_usd } : a,
          )
          runPatch.decision = { ...run.decision, actions }
        }
        break
      }
      case 'decision.completed': {
        const d = (ev.data as { decision?: DecisionResult }).decision
        if (d) {
          runPatch.decision = d
          runPatch.approvalStatus = d.status
        }
        break
      }
      case 'report.completed': {
        const r = (ev.data as { report?: ExecutiveReport }).report
        if (r) runPatch.report = r
        break
      }
      case 'approval.granted':
      case 'approval.denied': {
        const st = (ev.data as { approval_status?: ApprovalStatus }).approval_status
        if (st) runPatch.approvalStatus = st
        break
      }
      case 'pipeline.completed':
        runPatch.streamState = 'closed'
        // Refresh both history feeds so the anomaly list + audit drawer
        // show the run that just finished without a page reload.
        void useRunStore.getState().loadDetections()
        void useRunStore.getState().loadAudit()
        // Invalidate Movie Detail react-query caches for this film so the
        // Past Runs timeline + latest-investigation panel pick up the run
        // that just finished. filmId lives on the per-run bucket; falls
        // through to a no-op when the run was global (e.g. dashboard).
        if (run.filmId != null) {
          void queryClient.invalidateQueries({
            queryKey: ['catalog', 'film', run.filmId],
          })
        }
        break
      case 'pipeline.failed':
        runPatch.streamState = 'error'
        break
    }

    const updatedRun: ActiveRunState = { ...run, ...runPatch }
    const patch: Partial<RunStore> = {
      activeRuns: { ...s.activeRuns, [runId]: updatedRun },
    }

    // Mirror to top-level singletons ONLY when this run has focus. Existing
    // consumers (AgentTrace, DashboardWorkspace, MovieDetail, panels) read
    // top-level; they'll switch automatically when focusRun swaps focus.
    if (s.focusedRunId === runId) {
      patch.events = updatedRun.events
      patch.detection = updatedRun.detection
      patch.findings = updatedRun.findings
      patch.decision = updatedRun.decision
      patch.report = updatedRun.report
      patch.approvalStatus = updatedRun.approvalStatus
      patch.mode = updatedRun.mode
      patch.streamState = updatedRun.streamState
    }

    set(patch)
    useRunStore.getState()._recomputePanels()
  },

  _recomputePanels: () => {
    const s = useRunStore.getState()
    const hasRun = s.runId !== null
    const streamError = s.streamState === 'error'
    const streaming = s.streamState === 'streaming' || s.streamState === 'closed'

    // If the pipeline completed (or we already have a final report), treat
    // the run as fully resolved — never flip panels back to error even if
    // the SSE connection drops afterward (Cloud Run instance replacement,
    // browser tab suspend, or PipelineRuntime eviction).
    const resolved = s.streamState === 'closed' || s.report !== null

    const panels: Record<PanelKey, PanelState> = {
      // Data-first: show detection if we have it, error only when empty.
      hero: !hasRun ? { kind: 'idle' }
        : s.detection ? { kind: 'success' }
        : (streamError && !resolved) ? { kind: 'error', message: 'Stream disconnected', retry: s.reset }
        : { kind: 'loading', substatus: 'Detecting anomaly…' },

      telemetry:
        Object.keys(s.metrics).length > 0 ? { kind: 'success' }
        : !hasRun ? { kind: 'idle' }
        : { kind: 'loading', substatus: 'Fetching rolling aggregates…' },

      anomaly:
        !s.apiReachable ? { kind: 'error', message: 'API unreachable', retry: () => void s.loadDetections() }
        : s.recentDetections.length > 0 ? { kind: 'success' }
        : hasRun && s.detection ? { kind: 'success' }
        : hasRun ? { kind: 'loading' }
        : { kind: 'empty', hint: 'Loading recent detections…' },

      // Data-first: if we have any trace events or findings, show them.
      trace: !hasRun ? { kind: 'idle' }
        : (s.events.length > 0 || s.findings.length > 0) ? { kind: 'success' }
        : (streamError && !resolved) ? { kind: 'error', message: 'Trace stream lost',
                          retry: () => s.connectStream(s.runId!) }
        : { kind: 'success' },

      recommendation:
        s.decision ? { kind: 'success' }
        : !hasRun ? { kind: 'idle' }
        : (streamError && !resolved) ? { kind: 'error', message: 'Decision stage failed', retry: s.reset }
        : { kind: 'loading', substatus: streaming ? 'Awaiting decision…' : 'Waiting…' },

      approval:
        s.decision ? { kind: 'success' }
        : s.auditRows.some((r) => r.approval_status === 'pending_approval')
          ? { kind: 'success' }
          : { kind: 'idle' },

      history:
        !s.apiReachable ? { kind: 'error', message: 'API unreachable', retry: () => void s.loadAudit() }
        : s.auditRows.length > 0 ? { kind: 'success' }
        : { kind: 'empty', hint: 'No past investigations yet' },
    }
    set({ panelStates: panels })
  },
    }),
    {
      name: 'scc-run-state',
      // Persist everything the UI needs to reconstruct panels after a
      // refresh / tab-suspend / Cloud Run instance replacement — including
      // in-flight runs (any triggered inject should survive), the audit
      // history (RecentRuns hydrates instantly), and cached feed data.
      partialize: (state) => ({
        runId: state.runId,
        currentRunFilmId: state.currentRunFilmId,
        events: state.events,
        detection: state.detection,
        findings: state.findings,
        decision: state.decision,
        report: state.report,
        approvalStatus: state.approvalStatus,
        mode: state.mode,
        latencyMs: state.latencyMs,
        recentDetections: state.recentDetections,
        auditRows: state.auditRows,
        metrics: state.metrics,
        selectedFilmId: state.selectedFilmId,
        selectedRegion: state.selectedRegion,
        activeRuns: state.activeRuns,
        focusedRunId: state.focusedRunId,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            // Fill in fields that were added to ActiveRunState after the
            // multi-run refactor. Users with older persisted state have
            // entries whose events/findings/detection/etc. are undefined —
            // projecting undefined onto top-level via focusRun crashes
            // AgentTrace's `for (const e of events)` loop.
            const normalized: Record<string, ActiveRunState> = {}
            for (const [rid, r] of Object.entries(state.activeRuns ?? {})) {
              const raw = r as Partial<ActiveRunState>
              normalized[rid] = {
                filmId: raw.filmId ?? null,
                region: raw.region ?? null,
                streamState: raw.streamState ?? 'closed',
                startedAt: raw.startedAt ?? Date.now(),
                events: raw.events ?? [],
                detection: raw.detection ?? null,
                findings: raw.findings ?? [],
                decision: raw.decision ?? null,
                report: raw.report ?? null,
                approvalStatus: raw.approvalStatus ?? null,
                mode: raw.mode ?? null,
              }
            }
            useRunStore.setState({
              activeRuns: normalized,
              // Belt-and-braces: heal top-level fields in case an older
              // store version serialized any of them as undefined. Every
              // downstream consumer assumes these are arrays.
              events: Array.isArray(state.events) ? state.events : [],
              findings: Array.isArray(state.findings) ? state.findings : [],
              recentDetections: Array.isArray(state.recentDetections) ? state.recentDetections : [],
              auditRows: Array.isArray(state.auditRows) ? state.auditRows : [],
            })

            // Restored from a previous session — the SSE stream is long
            // gone, so mark the run as closed and recompute panels so the
            // persisted data renders immediately instead of showing idle.
            if (state.runId) {
              useRunStore.setState({ streamState: 'closed' })
            }
            useRunStore.getState()._recomputePanels()
          }
        }
      },
    },
  ),
)
