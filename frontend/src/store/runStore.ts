import { create } from 'zustand'
import type {
  SseEvent, DetectionRow, Finding, DecisionResult, ExecutiveReport,
  ApprovalStatus, AuditRow, MetricsResponse, CrisisType,
} from '@/api/contracts'
import { apiGet, apiPost } from '@/api/client'
import { openStream } from '@/api/sse'

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
  inject: (opts?: { crisisType?: CrisisType; fallback?: 'force' }) => Promise<string>
  connectStream: (runId: string) => void
  approve: (decisionId: string, note?: string) => Promise<void>
  deny: (decisionId: string, reason: string) => Promise<void>
  loadDetections: (limit?: number) => Promise<void>
  loadAudit: (limit?: number) => Promise<void>
  loadMetrics: (filmId: number, region: string, hours?: number) => Promise<void>
  reset: () => void
  _dispatch: (ev: SseEvent) => void
  _recomputePanels: () => void
}

const INITIAL_PANELS: Record<PanelKey, PanelState> = {
  hero: { kind: 'idle' },
  telemetry: { kind: 'idle' },
  anomaly: { kind: 'empty', hint: 'No anomalies in the last 6 hours — system nominal' },
  trace: { kind: 'idle' },
  recommendation: { kind: 'idle' },
  approval: { kind: 'idle' },
  history: { kind: 'idle' },
}

const INITIAL: Omit<RunStore, keyof {
  inject: never; connectStream: never; approve: never; deny: never;
  loadDetections: never; loadAudit: never; loadMetrics: never; reset: never;
  _dispatch: never; _recomputePanels: never;
}> = {
  runId: null,
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

export const useRunStore = create<RunStore>((set, _get) => ({
  ...INITIAL,

  inject: async (opts) => {
    const body: Record<string, unknown> = {}
    if (opts?.crisisType) body.ctype = opts.crisisType
    if (opts?.fallback) body.fallback = opts.fallback
    const res = await apiPost<{ run_id: string; stream_url?: string }>(
      '/inject-crisis', body,
    )
    const runId = res.run_id
    set({ runId, streamState: 'connecting' })
    useRunStore.getState().connectStream(runId)
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

  loadMetrics: async (filmId, region, hours = 48) => {
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
      case 'pipeline.completed': patch.streamState = 'closed'; break
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

    const panels: Record<PanelKey, PanelState> = {
      hero: !hasRun ? { kind: 'idle' }
        : streamError ? { kind: 'error', message: 'Stream disconnected', retry: s.reset }
        : s.detection ? { kind: 'success' }
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
        : { kind: 'empty', hint: 'No anomalies in the last 6 hours — system nominal' },

      trace: !hasRun ? { kind: 'idle' }
        : streamError ? { kind: 'error', message: 'Trace stream lost',
                          retry: () => s.connectStream(s.runId!) }
        : { kind: 'success' },

      recommendation:
        s.decision ? { kind: 'success' }
        : !hasRun ? { kind: 'idle' }
        : streamError ? { kind: 'error', message: 'Decision stage failed', retry: s.reset }
        : { kind: 'loading', substatus: streaming ? 'Awaiting decision…' : 'Waiting…' },

      approval:
        s.decision ? { kind: 'success' }
        : { kind: 'idle' },

      history:
        !s.apiReachable ? { kind: 'error', message: 'API unreachable', retry: () => void s.loadAudit() }
        : s.auditRows.length > 0 ? { kind: 'success' }
        : { kind: 'empty', hint: 'No past investigations yet' },
    }
    set({ panelStates: panels })
  },
}))
