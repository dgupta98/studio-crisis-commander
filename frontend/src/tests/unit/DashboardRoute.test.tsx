import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardRoute from '../../routes/DashboardRoute'
import { useRunStore } from '../../store/runStore'
import type { DetectionRow } from '../../api/contracts'

vi.mock('../../hooks/useIntakeRates', () => ({ useIntakeRates: () => {} }))

const seedRow: DetectionRow = {
  metric_ts: '2026-08-09T00:00:00Z',
  metric: 'sentiment_hourly',
  film_id: 1,
  region: 'Brazil',
  detector: 'z',
  baseline_value: 0,
  actual_value: 0,
  magnitude: 5,
  business_impact: 100000,
  severity: 6,
  dedup_key: 'seed',
}

beforeEach(() => {
  useRunStore.getState().reset()
  // Seed enough state so each panel's PanelStateWrapper renders its Card
  // (success branch), which is where the data-testids live.
  useRunStore.setState({
    runId: 'test-run',
    streamState: 'streaming',
    detection: seedRow,
    recentDetections: [seedRow],
    metrics: {
      '1:Brazil': {
        query_latency_ms: 12,
        timeseries: {
          box_office_daily: [],
          social_virality_hourly: [],
          sentiment_hourly: [],
          trailer_hourly: [],
        },
      } as any,
    },
  })
  useRunStore.getState()._recomputePanels()
})

describe('DashboardRoute', () => {
  it('renders intake, anomaly feed, workspace, trace, telemetry regions', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardRoute />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByTestId('intake-strip')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('anomaly-feed')).toBeInTheDocument()
    expect(screen.getByTestId('agent-trace')).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-strip')).toBeInTheDocument()
  })
})
