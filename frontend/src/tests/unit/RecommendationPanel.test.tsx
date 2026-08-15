import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecommendationPanel } from '@/panels/RecommendationPanel'
import { useRunStore } from '@/store/runStore'

beforeEach(() => useRunStore.getState().reset())

const DECISION = {
  decision_id: 'd-1', investigation_id: 'i-1', status: 'pending_approval',
  threshold_usd: 250000, created_at: 't', latency_ms: 100,
  actions: [{
    action_type: 'shift_marketing_spend',
    rationale: 'Reallocate Brazil budget to Korea based on virality delta.',
    params: { from: 'Brazil', to: 'Korea', usd: 100000 },
    impact_usd: 120000, impact_sql: 'SELECT sum(virality) FROM social_trends',
    impact_error: '', priority: 1 as const,
  }],
} as never

const REPORT = {
  report_id: 'r-1', decision_id: 'd-1',
  headline: 'Brazil sentiment collapse — reallocate to Korea',
  tldr: 'Sentiment dropped 28% in Brazil while Korea virality is up 40%; reallocate.',
  key_figures: [{
    label: 'Brazil sentiment delta', value: '-28%',
    source_query: 'SELECT avg(sentiment) FROM social_sentiment WHERE region = \'Brazil\'',
    source: { signal: 'numeric_context' as const, query_index: 0 },
  }],
  recommended_actions_prose: 'Long enough prose describing the recommended actions here.',
  risks_and_caveats: '', created_at: 't', latency_ms: 10,
} as never

describe('RecommendationPanel', () => {
  it('idle → placeholder', () => {
    render(<RecommendationPanel />)
    expect(screen.getByText(/awaiting|idle/i)).toBeInTheDocument()
  })

  it('renders headline + tldr + action rows + key_figures', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      decision: DECISION, report: REPORT,
    })
    useRunStore.getState()._recomputePanels()
    render(<RecommendationPanel />)
    expect(screen.getByText(/reallocate to Korea/i)).toBeInTheDocument()
    expect(screen.getByText(/Brazil sentiment delta/)).toBeInTheDocument()
    expect(screen.getByText('-28%')).toBeInTheDocument()
    expect(screen.getByText(/shift_marketing_spend/i)).toBeInTheDocument()
  })

  it('clicking a key_figure opens provenance popover with source_query', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      decision: DECISION, report: REPORT,
    })
    useRunStore.getState()._recomputePanels()
    render(<RecommendationPanel />)
    fireEvent.click(screen.getByText('-28%'))
    expect(screen.getByText(/SELECT avg\(sentiment\)/)).toBeInTheDocument()
  })
})
