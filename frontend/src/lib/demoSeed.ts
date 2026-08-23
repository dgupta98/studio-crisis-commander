import type {
  SseEvent, DetectionRow, Finding, DecisionResult,
  ExecutiveReport, CrisisType,
} from '@/api/contracts'

// Raw shape of a data/eval_cache/*.json file.
export interface CachedTriple {
  scenario_id: string
  detection: DetectionRow
  investigation: {
    investigation_id: string
    detection: DetectionRow
    findings: Finding[]
    hypothesis: {
      primary_cause: string
      contributing_factors: string[]
      confidence: 'low' | 'medium' | 'high'
      citations: string[]
    }
    started_at?: string
    finished_at?: string
  }
  decision: DecisionResult
  report: ExecutiveReport
}

export interface SeedResult {
  runId: string
  events: SseEvent[]
  detection: DetectionRow
  findings: Finding[]
  decision: DecisionResult
  report: ExecutiveReport
  currentRunFilmId: number
}

// Best-guess CrisisType from the detection's metric — used only to pick a
// human-readable label for the trace card, not for any real decision logic.
function inferCrisisType(metric: string): CrisisType {
  if (metric.startsWith('social_trends.avg_sentiment')) return 'regional_sentiment_collapse'
  if (metric.startsWith('social_trends.avg_virality')) return 'negative_social_virality'
  if (metric.startsWith('trailer_analytics')) return 'trailer_variant_underperformance'
  if (metric.startsWith('box_office_revenue')) return 'competitor_release_impact'
  if (metric.startsWith('campaign_performance')) return 'marketing_overspend_low_roi'
  if (metric.startsWith('streaming_watch_minutes')) return 'streaming_completion_drop'
  if (metric.startsWith('ticket_refunds')) return 'refund_spike'
  if (metric.startsWith('review_scores')) return 'review_score_divergence'
  return 'regional_sentiment_collapse'
}

// Synthesize the SSE event sequence a live run would have emitted, so
// AgentTrace can replay it without a real backend stream.
export function seedFromCachedTriple(triple: CachedTriple): SeedResult {
  const now = new Date().toISOString()
  const runId = `demo:${triple.scenario_id}`
  const mode = 'fallback' as const
  const det = triple.detection
  const ctype = inferCrisisType(det.metric)
  let seq = 0
  const push = (type: string, data: Record<string, unknown>): SseEvent => ({
    seq: seq++,
    ts: now,
    type,
    data: { ...data, mode },
  })

  const events: SseEvent[] = []
  events.push(push('pipeline.started', {
    run_id: runId,
    mode,
    // Populate `requested` so the Injection card in the trace has something
    // to render — otherwise seeded triples show an empty "crisis injected"
    // header with no context.
    requested: {
      ctype,
      film_id: det.film_id,
      region: det.region,
      magnitude: det.magnitude,
    },
  }))
  events.push(push('detection.started', {
    crisis: {
      type: ctype,
      film_id: det.film_id,
      film_title: det.film_title,
      region: det.region,
      magnitude: det.magnitude,
      true_root_cause: '',
      expected_recommendation: '',
      affected_tables: [],
    },
  }))
  events.push(push('detection.completed', { detection: det, source: 'cache' }))
  events.push(push('investigation.started', {}))
  for (const f of triple.investigation.findings) {
    events.push(push('signal.completed', { finding: f }))
  }
  events.push(push('hypothesis.formed', { hypothesis: triple.investigation.hypothesis }))
  events.push(push('investigation.completed', {
    investigation: triple.investigation,
  }))
  events.push(push('decision.started', {}))
  triple.decision.actions.forEach((a, i) => {
    events.push(push('action.proposed', {
      action_index: i,
      action_type: a.action_type,
      params: a.params,
      priority: a.priority,
      rationale: a.rationale,
    }))
    events.push(push('action.impact_computed', {
      action_index: i,
      action_type: a.action_type,
      impact_usd: a.impact_usd,
      impact_error: a.impact_error,
    }))
  })
  events.push(push('decision.completed', {
    decision: triple.decision,
    status: triple.decision.status,
    threshold_usd: triple.decision.threshold_usd,
  }))
  events.push(push('report.started', {}))
  events.push(push('report.completed', { report: triple.report }))
  events.push(push('pipeline.completed', {
    run_id: runId, latency_ms: 0, mode,
  }))

  return {
    runId,
    events,
    detection: det,
    findings: triple.investigation.findings,
    decision: triple.decision,
    report: triple.report,
    currentRunFilmId: det.film_id,
  }
}
