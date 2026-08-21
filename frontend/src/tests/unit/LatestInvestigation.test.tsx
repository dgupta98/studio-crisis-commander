import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LatestInvestigation } from '../../panels/LatestInvestigation'

const triple = {
  scenario_id: 'sc_001',
  detection: { magnitude: 3.2, severity: 'high', metric: 'box_office', region: 'US', latency_ms: 234 },
  investigation: { headline: 'Compet release siphon', hypotheses: [], findings: [] },
  decision: { recommended_actions: [{ label: 'Bump paid social', impact_est: 0.15 }] },
  report: { headline: 'Reallocate spend to reviews_stream family', body: '…' },
}

describe('LatestInvestigation', () => {
  it('renders report headline first', () => {
    render(<LatestInvestigation triple={triple as any} />)
    expect(screen.getByText(/reallocate spend/i)).toBeInTheDocument()
  })
  it('renders recommended actions', () => {
    render(<LatestInvestigation triple={triple as any} />)
    expect(screen.getByText(/bump paid social/i)).toBeInTheDocument()
  })
  it('renders detection latency badge', () => {
    render(<LatestInvestigation triple={triple as any} />)
    expect(screen.getByText('234ms')).toBeInTheDocument()
  })
  it('renders empty state when no triple', () => {
    render(<LatestInvestigation triple={null} />)
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument()
  })
})
