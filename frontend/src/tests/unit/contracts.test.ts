import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type {
  SseEvent, DetectionRow, InvestigationResult, DecisionResult,
  ExecutiveReport, CrisisType, MetricsResponse, AuditRow,
} from '@/api/contracts'
import {
  isSseEvent, isInvestigationResult, isDecisionResult, isExecutiveReport,
} from '@/api/contracts'

const TRIPLE_PATH = path.resolve(
  __dirname, '../../../..', 'backend/api/cached/fallback_triple.json',
)

describe('api contracts', () => {
  it('SseEvent shape has seq/ts/type/data', () => {
    const e: SseEvent = { seq: 0, ts: '2026-08-09T12:00:00.000+00:00',
                          type: 'detection.completed', data: { mode: 'live' } }
    expect(isSseEvent(e)).toBe(true)
  })

  it('CrisisType is one of the 4 known variants', () => {
    const ok: CrisisType[] = [
      'SENTIMENT_COLLAPSE',
      'REGIONAL_SENTIMENT_COLLAPSE',
      'COMPETITOR_RELEASE',
      'BUDGET_OVERRUN',
    ]
    expect(ok.length).toBe(4)
  })

  it('the cached fallback triple parses against InvestigationResult+DecisionResult+ExecutiveReport', () => {
    const raw = JSON.parse(fs.readFileSync(TRIPLE_PATH, 'utf-8'))
    expect(raw.investigation).toBeDefined()
    expect(raw.decision).toBeDefined()
    expect(raw.report).toBeDefined()

    const inv = raw.investigation as InvestigationResult
    expect(isInvestigationResult(inv)).toBe(true)
    expect(inv.findings.length).toBe(4)
    expect(['low', 'medium', 'high']).toContain(inv.hypothesis.confidence)

    const dec = raw.decision as DecisionResult
    expect(isDecisionResult(dec)).toBe(true)
    expect(dec.actions.length).toBeGreaterThanOrEqual(1)
    expect(dec.actions.length).toBeLessThanOrEqual(3)

    const rep = raw.report as ExecutiveReport
    expect(isExecutiveReport(rep)).toBe(true)
    expect(rep.key_figures.length).toBeGreaterThanOrEqual(1)
    expect(rep.key_figures.length).toBeLessThanOrEqual(8)
  })

  it('MetricsResponse shape has 4 named timeseries keys', () => {
    const m: MetricsResponse = {
      film_id: 1, region: 'Brazil',
      timeseries: {
        box_office_daily: [],
        social_virality_hourly: [],
        sentiment_hourly: [],
        trailer_hourly: [],
      },
      query_latency_ms: 47,
    }
    expect(Object.keys(m.timeseries).sort()).toEqual([
      'box_office_daily', 'sentiment_hourly',
      'social_virality_hourly', 'trailer_hourly',
    ])
  })

  it('AuditRow shape has decision_id + approval_status + created_at', () => {
    const row: AuditRow = {
      audit_id: 'a-1', decision_id: 'd-1', investigation_id: 'i-1',
      created_at: '2026-08-09T00:00:00Z',
      approval_status: 'pending_approval',
      approver: '', approval_note: '', denial_reason: '',
      threshold_usd: 250000, total_impact_usd: 100000,
      film_id: 1, region: 'Brazil',
      report_id: '', report_headline: '',
    }
    expect(row.approval_status).toBe('pending_approval')
  })
})
