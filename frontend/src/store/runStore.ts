import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  SseEvent, DetectionRow, Finding, DecisionResult, ExecutiveReport,
  ApprovalStatus, AuditRow, MetricsResponse, CrisisType,
} from '@/api/contracts'
import { apiGet, apiPost } from '@/api/client'
import { openStream } from '@/api/sse'
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
  latencyMs: number | null

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
    magnitude?: number
    fallback?: 'force'
  }) => Promise<string>
  connectStream: (runId: string) => void
  approve: (decisionId: string, note?: string) => Promise<void>
  deny: (decisionId: string, reason: string) => Promise<void>
  loadDetections: (limit?: number) => Promise<void>
  loadAudit: (limit?: number) => Promise<void>
  loadMetrics: (filmId: number, region: string, hours?: number) => Promise<void>
  seedFromCached: (scenarioId?: string) => Promise<boolean>
  reset: () => void
  _dispatch: (ev: SseEvent) => void
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
  latencyMs: null,
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
    if (opts?.region) body.region = opts.region
    if (opts?.magnitude !== undefined) body.magnitude = opts.magnitude
    if (opts?.fallback) body.fallback = opts.fallback
    // Clear any prior run's residue before starting a new one so the trace/
    // decision/report panels don't briefly show the previous investigation.
    // Set currentRunFilmId immediately from opts so Movie Detail's scoped
    // AgentTrace matches BEFORE detection.completed arrives (or if the
    // pipeline hangs mid-detection).
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
    const res = await apiPost<{ run_id: string; stream_url?: string }>(
      '/inject-crisis', body,
    )
    const runId = res.run_id
    set({ runId, streamState: 'connecting' })
    useRunStore.getState().connectStream(runId)
    useRunStore.getState()._recomputePanels()
    return runId
  },

  connectStream: (runId: string) => {
    const prev = useRunStore.getState()._closeStream
    set({ _closeStream: null })  // clear before invoking so a sync openStream throw can't leave a stale ref
    prev?.()
    const close = openStream(
      runId,
      (payload) => useRunStore.getState()._dispatch(payload as SseEvent),
      (_err) => {
        set({ streamState: 'error' })
        useRunStore.getState()._recomputePanels()
      },
    )
    set({ streamState: 'connecting', _closeStream: close })
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

  reset: () => {
    const { _closeStream } = useRunStore.getState()
    set({ ...INITIAL })
    _closeStream?.()
  },

  _dispatch: (ev) => {
    const s = useRunStore.getState()

    // Dedupe by seq — server replays on reconnect (Layer 4 §6).
    if (s.events.some((e) => e.seq === ev.seq)) return

    const patch: Partial<RunStore> = { events: [...s.events, ev] }
    if (s.streamState === 'connecting' || s.streamState === 'idle') {
      patch.streamState = 'streaming'
    }
    if (!s.mode && (ev.data as { mode?: 'live' | 'fallback' })?.mode) {
      patch.mode = (ev.data as { mode?: 'live' | 'fallback' }).mode ?? null
    }

    switch (ev.type) {
      case 'detection.completed': {
        const d = (ev.data as { detection?: DetectionRow }).detection
        if (d) {
          patch.detection = d
          // fire-and-forget metrics fetch for the affected film/region
          void useRunStore.getState().loadMetrics(d.film_id, d.region)
        }
        break
      }
      case 'signal.completed': {
        const f = (ev.data as { finding?: Finding }).finding
        if (f) patch.findings = [...s.findings, f]
        break
      }
      case 'action.impact_computed': {
        // merge impact into the matching action; keeps decision reactive
        const p = ev.data as { action_index?: number; impact_usd?: number }
        if (s.decision && typeof p.action_index === 'number') {
          const actions = s.decision.actions.map((a, i) =>
            i === p.action_index ? { ...a, impact_usd: p.impact_usd ?? a.impact_usd } : a,
          )
          patch.decision = { ...s.decision, actions }
        }
        break
      }
      case 'decision.completed': {
        const d = (ev.data as { decision?: DecisionResult }).decision
        if (d) {
          patch.decision = d
          patch.approvalStatus = d.status
        }
        break
      }
      case 'report.completed': {
        const r = (ev.data as { report?: ExecutiveReport }).report
        if (r) patch.report = r
        break
      }
      case 'approval.granted':
      case 'approval.denied': {
        const st = (ev.data as { approval_status?: ApprovalStatus }).approval_status
        if (st) patch.approvalStatus = st
        break
      }
      case 'pipeline.completed':
        patch.streamState = 'closed'
        // Refresh both history feeds so the anomaly list + audit drawer
        // show the run that just finished without a page reload.
        void useRunStore.getState().loadDetections()
        void useRunStore.getState().loadAudit()
        break
      case 'pipeline.failed':    patch.streamState = 'error';  break
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
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
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
