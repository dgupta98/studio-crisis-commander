import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegionHeatBar } from '@/panels/RegionHeatBar'
import * as regionApi from '@/api/regionMetrics'
import { useRunStore } from '@/store/runStore'

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{child}</QueryClientProvider>
}

describe('RegionHeatBar', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('renders 15 tiles even before data loads', () => {
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockReturnValue(new Promise(() => {}))
    render(wrap(<RegionHeatBar filmId={1} />))
    const tiles = screen.getAllByRole('button')
    expect(tiles).toHaveLength(15)
  })

  it('merges backend data into canonical 15 tiles', async () => {
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockResolvedValue({
      film_id: 1, hours: 168, query_latency_ms: 42,
      regions: [
        { code: 'Brazil',
          signals: {
            box_office: { volume: 999, delta_pct: 20, anomaly: true },
            social:     { volume: 100, delta_pct: 0,  anomaly: false },
            reviews:    { volume:  50, delta_pct: 0,  anomaly: false },
            streaming:  { volume: 200, delta_pct: 0,  anomaly: false },
          },
          open_investigation: true,
        },
      ],
    })
    render(wrap(<RegionHeatBar filmId={1} />))
    await waitFor(() => expect(screen.getByText('42ms')).toBeInTheDocument())
    // Still 15 tiles (14 empty + 1 Brazil)
    expect(screen.getAllByRole('button')).toHaveLength(15)
  })
})
