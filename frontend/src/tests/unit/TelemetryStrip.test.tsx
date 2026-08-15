import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TelemetryStrip } from '@/panels/TelemetryStrip'
import { useRunStore } from '@/store/runStore'

beforeEach(() => useRunStore.getState().reset())

describe('TelemetryStrip', () => {
  it('idle → shows placeholder', () => {
    render(<TelemetryStrip />)
    expect(screen.getByText(/telemetry/i)).toBeInTheDocument()
  })

  it('with metrics → renders 4 sparkline labels + latency badge', () => {
    useRunStore.setState({
      runId: 'r-1', streamState: 'streaming',
      latencyMs: 47,
      metrics: { '1:Brazil': {
        film_id: 1, region: 'Brazil', query_latency_ms: 47,
        timeseries: {
          box_office_daily: [{ ts: 't', value: 1 }],
          social_virality_hourly: [{ ts: 't', value: 2 }],
          sentiment_hourly: [{ ts: 't', value: 3 }],
          trailer_hourly: [{ ts: 't', value: 4 }],
        },
      } },
    })
    useRunStore.getState()._recomputePanels()
    render(<TelemetryStrip />)
    expect(screen.getByText(/Box Office/i)).toBeInTheDocument()
    expect(screen.getByText(/Sentiment/i)).toBeInTheDocument()
    expect(screen.getByText(/Trailer/i)).toBeInTheDocument()
    expect(screen.getByText(/Virality/i)).toBeInTheDocument()
    expect(screen.getByText(/47 ms/i)).toBeInTheDocument()
  })
})
