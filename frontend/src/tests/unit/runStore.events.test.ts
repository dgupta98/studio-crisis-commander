import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import type { SseEvent } from '@/api/contracts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mk(seq: number, type: string, data: Record<string, unknown>): SseEvent<any> {
  return { seq, type, data, ts: `2026-08-09T00:00:${String(seq).padStart(2, '0')}Z` }
}

const DET = {
  metric_ts: 't', metric: 'sentiment', film_id: 1, region: 'Brazil',
  detector: 'z', baseline_value: 0, actual_value: 0, magnitude: 8.4,
  business_impact: 100000, severity: 8, dedup_key: 'k',
}

beforeEach(() => useRunStore.getState().reset())
afterEach(() => { vi.restoreAllMocks() })

describe('event routing', () => {
  it('detection.completed → sets detection, auto-fires loadMetrics', async () => {
    const spy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      film_id: 1, region: 'Brazil', query_latency_ms: 47,
      timeseries: { box_office_daily: [], social_virality_hourly: [],
                    sentiment_hourly: [], trailer_hourly: [] },
    })
    useRunStore.getState()._dispatch(mk(0, 'detection.completed', { detection: DET, mode: 'live' }))
    expect(useRunStore.getState().detection?.magnitude).toBe(8.4)
    // Wait for the auto-loadMetrics microtask to settle.
    await Promise.resolve()
    await Promise.resolve()
    expect(spy).toHaveBeenCalled()
  })

  it('signal.completed × 4 → findings length grows to 4', () => {
    const s = useRunStore.getState()
    const signals = ['numeric_context', 'text_reason', 'categorical_isolation', 'temporal_context']
    signals.forEach((sig, i) => {
      s._dispatch(mk(i, 'signal.completed', { finding: {
        signal: sig, sql: 'SELECT 1', columns: [], rows: [], narrative: 'x', latency_ms: 10,
      }}))
    })
    expect(useRunStore.getState().findings.length).toBe(4)
  })

  it('decision.completed → sets decision', () => {
    const dec = { decision_id: 'd-1', investigation_id: 'i-1', actions: [{
      action_type: 'shift_marketing_spend', rationale: 'long enough rationale here to pass',
      params: {}, impact_usd: 100000, impact_sql: 'SELECT 1', impact_error: '', priority: 1,
    }], status: 'pending_approval', threshold_usd: 250000,
    created_at: 't', latency_ms: 100 }
    useRunStore.getState()._dispatch(mk(0, 'decision.completed', { decision: dec }))
    expect(useRunStore.getState().decision?.decision_id).toBe('d-1')
  })

  it('report.completed → sets report', () => {
    const rep = { report_id: 'r-1', decision_id: 'd-1',
      headline: 'A twenty-plus char headline',
      tldr: 'A forty-plus char tldr summary that says enough words.',
      key_figures: [{ label: 'X', value: '1',
        source_query: 'SELECT 1 FROM t',
        source: { signal: 'numeric_context', query_index: 0 } }],
      recommended_actions_prose: 'Forty plus chars of prose describing the recommended actions.',
      risks_and_caveats: '', created_at: 't', latency_ms: 10 }
    useRunStore.getState()._dispatch(mk(0, 'report.completed', { report: rep }))
    expect(useRunStore.getState().report?.report_id).toBe('r-1')
  })

  it('approval.granted / approval.denied → flip approvalStatus', () => {
    useRunStore.getState()._dispatch(mk(0, 'approval.granted', { approval_status: 'approved' }))
    expect(useRunStore.getState().approvalStatus).toBe('approved')
    useRunStore.getState()._dispatch(mk(1, 'approval.denied', { approval_status: 'denied' }))
    expect(useRunStore.getState().approvalStatus).toBe('denied')
  })

  it('pipeline.completed → streamState becomes closed', () => {
    useRunStore.getState()._dispatch(mk(0, 'pipeline.completed', {}))
    expect(useRunStore.getState().streamState).toBe('closed')
  })

  it('pipeline.failed → streamState becomes error', () => {
    useRunStore.getState()._dispatch(mk(0, 'pipeline.failed', { error: 'boom' }))
    expect(useRunStore.getState().streamState).toBe('error')
  })

  it('mode is captured from any event whose data.mode is set (first write wins)', () => {
    useRunStore.getState()._dispatch(mk(0, 'detection.started', { mode: 'fallback' }))
    expect(useRunStore.getState().mode).toBe('fallback')
    useRunStore.getState()._dispatch(mk(1, 'signal.completed', { mode: 'live', finding: {
      signal: 'numeric_context', sql: 'x', columns: [], rows: [], narrative: '', latency_ms: 0,
    }}))
    expect(useRunStore.getState().mode).toBe('fallback')  // first-write-wins
  })

  it('dedupe by seq — same seq event ignored on replay', () => {
    useRunStore.getState()._dispatch(mk(3, 'x', {}))
    useRunStore.getState()._dispatch(mk(1, 'y', {}))
    useRunStore.getState()._dispatch(mk(3, 'x-dup', {}))
    expect(useRunStore.getState().events.map(e => e.seq)).toEqual([3, 1])
  })
})

describe('derived panelStates', () => {
  it('idle store → hero=idle, anomaly=empty, others=idle', () => {
    const p = useRunStore.getState().panelStates
    expect(p.hero.kind).toBe('idle')
    expect(p.anomaly.kind).toBe('empty')
    expect(p.trace.kind).toBe('idle')
  })

  it('with runId + no detection yet → hero=loading, trace=success', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming' })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.hero.kind).toBe('loading')
    expect(p.trace.kind).toBe('success')
  })

  it('with detection + decision + report → recommendation=success, approval=success', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      detection: DET as never,
      decision: { decision_id: 'd', investigation_id: 'i', actions: [] as never,
                  status: 'pending_approval', threshold_usd: 0, created_at: 't', latency_ms: 0 } as never,
    })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.recommendation.kind).toBe('success')
    expect(p.approval.kind).toBe('success')
    expect(p.hero.kind).toBe('success')
  })

  it('apiReachable=false → anomaly=error, history=error', () => {
    useRunStore.setState({ apiReachable: false })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.anomaly.kind).toBe('error')
    expect(p.history.kind).toBe('error')
  })

  it('streamState=error → trace=error, hero=error', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'error' })
    useRunStore.getState()._recomputePanels()
    const p = useRunStore.getState().panelStates
    expect(p.trace.kind).toBe('error')
    expect(p.hero.kind).toBe('error')
  })
})
