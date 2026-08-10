/**
 * TypeScript mirrors of backend Pydantic contracts.
 * Source of truth: backend/agents/{*}/contracts.py and backend/agents/decision/audit.py.
 * Keep this file in sync when backend contracts change; the fallback-triple
 * fixture test in contracts.test.ts catches drift.
 */

// ─── SSE ────────────────────────────────────────────────────────────
export interface SseEvent<T = unknown> {
  seq: number
  ts: string      // ISO 8601
  type: string    // dotted, e.g. "detection.completed"
  data: T & { mode?: 'live' | 'fallback' }
}

export function isSseEvent(x: unknown): x is SseEvent {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.seq === 'number' && typeof o.type === 'string'
      && typeof o.ts === 'string'
      && typeof o.data === 'object' && o.data !== null
}

// ─── Crisis / Detection ─────────────────────────────────────────────
export type CrisisType =
  | 'SENTIMENT_COLLAPSE'
  | 'REGIONAL_SENTIMENT_COLLAPSE'
  | 'COMPETITOR_RELEASE'
  | 'BUDGET_OVERRUN'

export interface DetectionRow {
  metric_ts: string
  metric: string
  film_id: number
  region: string
  detector: string
  baseline_value: number
  actual_value: number
  magnitude: number
  business_impact: number
  severity: number
  dedup_key: string
}

// ─── Investigation ──────────────────────────────────────────────────
export type SignalName =
  | 'numeric_context' | 'text_reason'
  | 'categorical_isolation' | 'temporal_context'

export interface SignalFinding {
  signal: SignalName
  sql: string
  columns: string[]
  rows: unknown[][]
  narrative: string
  latency_ms: number
}
export type Finding = SignalFinding   // alias

export interface Hypothesis {
  primary_cause: string
  contributing_factors: string[]
  confidence: 'low' | 'medium' | 'high'
  citations: SignalName[]
}

export interface InvestigationResult {
  investigation_id: string
  detection: DetectionRow
  findings: SignalFinding[]
  hypothesis: Hypothesis
  started_at: string
  finished_at: string
}

export function isInvestigationResult(x: unknown): x is InvestigationResult {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.investigation_id === 'string'
      && Array.isArray(o.findings)
      && typeof o.detection === 'object'
      && typeof o.hypothesis === 'object'
}

// ─── Decision ───────────────────────────────────────────────────────
export type ActionType =
  | 'shift_marketing_spend' | 'pause_campaign'
  | 'swap_trailer_variant' | 'issue_pr_statement' | 'escalate_to_human'

export type ApprovalStatus =
  | 'auto_executed' | 'pending_approval' | 'approved' | 'denied'

export interface RecommendedAction {
  action_type: ActionType
  rationale: string
  params: Record<string, unknown>  // backend uses untyped dict; narrow per action_type when backend adds discriminated models
  impact_usd: number | null
  impact_sql: string
  impact_error: string
  priority: 1 | 2 | 3
}
export type Action = RecommendedAction  // alias

export interface DecisionResult {
  decision_id: string
  investigation_id: string
  actions: RecommendedAction[]
  status: ApprovalStatus
  threshold_usd: number
  created_at: string
  latency_ms: number
}

export function isDecisionResult(x: unknown): x is DecisionResult {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.decision_id === 'string' && Array.isArray(o.actions)
}

// ─── Report ─────────────────────────────────────────────────────────
export interface FindingSource {
  signal: SignalName | 'decision_impact'
  query_index: number
}

export interface KeyFigure {
  label: string
  value: string
  source_query: string
  source: FindingSource
}

export interface ExecutiveReport {
  report_id: string
  decision_id: string
  headline: string
  tldr: string
  key_figures: KeyFigure[]
  recommended_actions_prose: string
  risks_and_caveats: string
  created_at: string
  latency_ms: number
}

export function isExecutiveReport(x: unknown): x is ExecutiveReport {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.report_id === 'string' && Array.isArray(o.key_figures)
      && typeof o.headline === 'string' && typeof o.tldr === 'string'
}

// ─── Metrics ────────────────────────────────────────────────────────
export interface MetricPoint {
  ts: string
  value: number
}

export interface MetricsResponse {
  film_id: number
  region: string
  timeseries: {
    box_office_daily: MetricPoint[]
    social_virality_hourly: MetricPoint[]
    sentiment_hourly: MetricPoint[]
    trailer_hourly: MetricPoint[]
  }
  query_latency_ms: number
}

// ─── Audit ──────────────────────────────────────────────────────────
export interface AuditRow {
  audit_id: string
  decision_id: string
  investigation_id: string
  created_at: string
  approval_status: ApprovalStatus
  approver: string
  approval_note: string
  denial_reason: string
  threshold_usd: number
  total_impact_usd: number
  film_id: number
  region: string
  report_id: string
  report_headline: string
}
