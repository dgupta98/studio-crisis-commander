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
    set({ _closeStream: null })
    prev?.()
    const close = openStream(
      runId,
      // onEvent — Task 8 wires the full router; for now, just record it.
      (payload) => {
        // The dispatch is implemented in Task 8. Keep append-only fallback here
        // so we can still test the plumbing.
        const evs = useRunStore.getState().events
        set({ events: [...evs, payload as SseEvent], streamState: 'streaming' })
      },
      (_err) => set({ streamState: 'error' }),
    )
    set({ _closeStream: close })
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
  },

  reset: () => {
    const { _closeStream } = useRunStore.getState()
    set({ ...INITIAL })
    _closeStream?.()
  },
}))
