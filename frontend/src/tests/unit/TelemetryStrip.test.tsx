import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TelemetryStrip, projectSeries } from '@/panels/TelemetryStrip'
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

describe('TelemetryStrip.projectSeries', () => {
  it('maps box_office_daily.revenue_usd → value', () => {
    const out = projectSeries('box_office', [
      { ts: '2026-08-10 10:00:00', revenue_usd: 12000, tickets_sold: 150 },
    ] as any)
    expect(out).toEqual([{ ts: '2026-08-10 10:00:00', value: 12000 }])
  })
  it('maps social_virality_hourly.avg_virality → value', () => {
    const out = projectSeries('social', [
      { ts: 't', avg_virality: 8, volume: 4 },
    ] as any)
    expect(out[0].value).toBe(8)
  })
  it('maps sentiment_hourly.avg_score → value', () => {
    const out = projectSeries('sentiment', [
      { ts: 't', avg_score: -3, volume: 128 },
    ] as any)
    expect(out[0].value).toBe(-3)
  })
  it('maps trailer_hourly.views → value', () => {
    const out = projectSeries('trailer', [
      { ts: 't', views: 555, completion_rate: 0.42 },
    ] as any)
    expect(out[0].value).toBe(555)
  })
  it('returns [] for empty input', () => {
    expect(projectSeries('box_office', [])).toEqual([])
  })
})
