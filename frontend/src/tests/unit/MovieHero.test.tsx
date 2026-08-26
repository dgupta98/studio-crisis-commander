import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MovieHero } from '../../panels/MovieHero'
import * as regionApi from '@/api/regionMetrics'

const film = {
  id: 42, title: 'Test Title', poster_url: 'x.jpg', release_date: '2025-01-01',
  popularity: 42.5,
  featured: true, cached_scenario_id: 'sc_001',
}

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MovieHero', () => {
  beforeEach(() => {
    // RegionHeatBar (rendered inside the hero) issues a react-query fetch on
    // mount. Stub it with a never-resolving promise so tests don't hit the
    // network or emit act() warnings from a late resolve.
    vi.spyOn(regionApi, 'fetchRegionMetrics').mockReturnValue(new Promise(() => {}))
  })

  it('renders title, release, and inject CTA', () => {
    render(wrap(<MovieHero film={film as any} onInject={() => {}} />))
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText(/2025/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inject crisis/i })).toBeInTheDocument()
  })

  it('badges featured with cached scenario id', () => {
    render(wrap(<MovieHero film={film as any} onInject={() => {}} />))
    expect(screen.getByText(/sc_001/i)).toBeInTheDocument()
  })

  it('inject CTA fires callback', () => {
    const cb = vi.fn()
    render(wrap(<MovieHero film={film as any} onInject={cb} />))
    screen.getByRole('button', { name: /inject crisis/i }).click()
    expect(cb).toHaveBeenCalled()
  })
})
