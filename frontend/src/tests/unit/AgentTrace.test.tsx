import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentTrace } from '@/panels/AgentTrace'
import { useRunStore } from '@/store/runStore'
import type { SseEvent } from '@/api/contracts'

const ev = (seq: number, type: string, data: object = {}): SseEvent =>
  ({ seq, type, data, ts: 't' })

beforeEach(() => useRunStore.getState().reset())

describe('AgentTrace', () => {
  it('idle — shows placeholder', () => {
    render(<AgentTrace />)
    expect(screen.getByText(/idle/i)).toBeInTheDocument()
  })

  it('renders one row per meaningful event, groups by stage', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      events: [
        ev(0, 'detection.started'),
        ev(1, 'detection.completed', { detection: { severity: 7 } }),
        ev(2, 'investigation.started'),
        ev(3, 'signal.completed', { finding: {
          signal: 'numeric_context', sql: 'SELECT 1', columns: [], rows: [], narrative: 'X', latency_ms: 10,
        }}),
        ev(4, 'decision.completed', { decision: { decision_id: 'd', actions: [] }}),
        ev(5, 'report.completed', { report: { report_id: 'r' }}),
        ev(6, 'pipeline.completed'),
        ev(7, 'approval.granted', { approval_id: 'a-1' }),
      ] as never,
    })
    useRunStore.getState()._recomputePanels()
    render(<AgentTrace />)
    // Section headings — exact h3 match so we don't collide with row labels
    // like "detection started" that also contain the word.
    for (const name of ['Detection', 'Investigation', 'Decision', 'Report']) {
      expect(
        screen.getByRole('heading', { level: 3, name }),
      ).toBeInTheDocument()
    }
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
    expect(screen.getByText(/granted/i)).toBeInTheDocument()
  })
})
