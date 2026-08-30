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
// Wire values match backend `data.ground_truth.CrisisType(str, Enum)`
// (lowercase snake_case). Sent as `ctype` in POST /inject-crisis.
export type CrisisType =
  | 'regional_sentiment_collapse'
  | 'trailer_variant_underperformance'
  | 'competitor_release_impact'
  | 'marketing_overspend_low_roi'
  | 'streaming_completion_drop'
  | 'refund_spike'
  | 'negative_social_virality'
  | 'review_score_divergence'

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
  film_title?: string
  latency_ms?: number | null
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
  // Backend falls back to a film-wide sentiment series when the region
  // query returns 0 rows (roll_sentiment_hourly is sparse). The frontend
  // uses this to label the Sentiment sparkline honestly. Optional so
  // older cached responses without the key still typecheck.
  sentiment_scope?: 'region' | 'film'
  timeseries: {
    box_office_daily: MetricPoint[]
    social_virality_hourly: MetricPoint[]
    sentiment_hourly: MetricPoint[]
    trailer_hourly: MetricPoint[]
  }
  query_latency_ms: number
}

export type BoxOfficeRawPoint = { ts: string; revenue_usd: number; tickets_sold: number }
export type SocialRawPoint    = { ts: string; avg_virality: number; volume: number }
export type SentimentRawPoint = { ts: string; avg_score: number;   volume: number }
export type TrailerRawPoint   = { ts: string; views: number;       completion_rate: number }

export type RawSeriesByFamily = {
  box_office: BoxOfficeRawPoint[]
  social:     SocialRawPoint[]
  sentiment:  SentimentRawPoint[]
  trailer:    TrailerRawPoint[]
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

// ─── Region Heat Matrix ─────────────────────────────────────────────
// Backend: GET /metrics/{film_id}/regions

export interface RegionSignalSummary {
  volume: number
  delta_pct: number
  anomaly: boolean
}

export interface RegionSummary {
  code: string
  signals: {
    box_office: RegionSignalSummary
    social:     RegionSignalSummary
    reviews:    RegionSignalSummary
    streaming:  RegionSignalSummary
  }
  open_investigation: boolean
}

export interface RegionMetricsResponse {
  film_id: number
  hours: number
  regions: RegionSummary[]
  query_latency_ms: number
}

// ─── Top-regions strip on catalog card ──────────────────────────────
export interface RegionDelta {
  code: string
  delta_pct: number
}
