import { create } from 'zustand'
import type {
  SseEvent, DetectionRow, Finding, DecisionResult, ExecutiveReport,
  ApprovalStatus, AuditRow, MetricsResponse, CrisisType,
} from '@/api/contracts'

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

  // Stubs — filled in Tasks 7-8.
  inject: async () => { throw new Error('inject: not implemented (Task 7)') },
  connectStream: () => { throw new Error('connectStream: not implemented (Task 7)') },
  approve: async () => { throw new Error('approve: not implemented (Task 7)') },
  deny: async () => { throw new Error('deny: not implemented (Task 7)') },
  loadDetections: async () => { throw new Error('loadDetections: not implemented (Task 7)') },
  loadAudit: async () => { throw new Error('loadAudit: not implemented (Task 7)') },
  loadMetrics: async () => { throw new Error('loadMetrics: not implemented (Task 7)') },

  reset: () => {
    const { _closeStream } = useRunStore.getState()
    set({ ...INITIAL })
    _closeStream?.()
  },
}))
