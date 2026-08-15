import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroBanner } from '@/panels/HeroBanner'
import { useRunStore } from '@/store/runStore'

const DET = {
  metric_ts: 't', metric: 'sentiment_hourly', film_id: 1, region: 'Brazil',
  detector: 'z_score', baseline_value: 0.2, actual_value: -0.6, magnitude: 8.4,
  business_impact: 250000, severity: 8, dedup_key: 'k',
}

beforeEach(() => useRunStore.getState().reset())

describe('HeroBanner', () => {
  it('idle state — shows "waiting" copy, not a live headline', () => {
    render(<HeroBanner />)
    expect(screen.getByText(/waiting/i)).toBeInTheDocument()
  })

  it('with detection — shows crisis label + film/region + magnitude', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming', detection: DET as never,
    })
    useRunStore.getState()._recomputePanels()
    render(<HeroBanner />)
    expect(screen.getByText(/Now Investigating/i)).toBeInTheDocument()
    expect(screen.getByText(/Brazil/)).toBeInTheDocument()
    expect(screen.getByText(/Film 1/i)).toBeInTheDocument()
  })

  it('fallback mode — shows REPLAY chip', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      detection: DET as never, mode: 'fallback',
    })
    useRunStore.getState()._recomputePanels()
    render(<HeroBanner />)
    expect(screen.getByText('REPLAY')).toBeInTheDocument()
  })
})
