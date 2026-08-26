import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MovieCommand } from '@/panels/MovieCommand'
import * as client from '@/api/client'
import * as regionApi from '@/api/regionMetrics'
import { useRunStore } from '@/store/runStore'

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{child}</QueryClientProvider>
}

describe('MovieCommand', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('renders empty state when no film is picked', () => {
    render(wrap(<MovieCommand />))
    expect(screen.getByText(/Pick a movie/i)).toBeInTheDocument()
  })

  it('renders film title once picked', async () => {
    vi.spyOn(client, 'apiGet').mockResolvedValue({
      id: 1, title: 'Foo Movie', poster_url: '',
      release_date: '2026-01-01', popularity: 42.0,
    })
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockResolvedValue({
      film_id: 1, hours: 168, query_latency_ms: 10, regions: [],
    })
    useRunStore.getState().pickFilm(1)
    render(wrap(<MovieCommand />))
    await waitFor(() => expect(screen.getByText('Foo Movie')).toBeInTheDocument())
  })
})
