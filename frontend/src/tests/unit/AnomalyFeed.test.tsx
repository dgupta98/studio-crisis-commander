import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnomalyFeed } from '@/panels/AnomalyFeed'
import { useRunStore } from '@/store/runStore'

beforeEach(() => useRunStore.getState().reset())

const row = (severity: number, region: string) => ({
  metric_ts: '2026-08-09T00:00:00Z', metric: 'sentiment_hourly',
  film_id: 1, region, detector: 'z', baseline_value: 0, actual_value: 0,
  magnitude: 5, business_impact: 100000, severity, dedup_key: `${region}-${severity}`,
})

describe('AnomalyFeed', () => {
  it('empty state — shows loading hint', () => {
    render(<AnomalyFeed />)
    expect(screen.getByText(/loading recent detections/i)).toBeInTheDocument()
  })

  it('renders anomaly rows with severity-colored chips', () => {
    useRunStore.setState({
      recentDetections: [row(9.5, 'Brazil'), row(6.0, 'Korea'), row(3.0, 'Germany')],
    })
    useRunStore.getState()._recomputePanels()
    render(<AnomalyFeed />)
    expect(screen.getByText('Brazil')).toBeInTheDocument()
    expect(screen.getByText('Korea')).toBeInTheDocument()
    expect(screen.getByText('Germany')).toBeInTheDocument()
    // severity threshold boundaries: >=8 critical, >=5 warn, else info
    expect(screen.getByText('critical')).toBeInTheDocument()
    expect(screen.getByText('warn')).toBeInTheDocument()
    expect(screen.getByText('info')).toBeInTheDocument()
  })
})
