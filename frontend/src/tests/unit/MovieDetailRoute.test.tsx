import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import MovieDetailRoute from '../../routes/MovieDetailRoute'

const film = {
  id: 42, title: 'Test', poster_url: '', release_date: '2025-01-01',
  popularity: 12, signals: { box_office: 1, social: 2, reviews: 3, streaming: 4 },
  featured: false, cached_scenario_id: null,
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://test.local')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('MovieDetailRoute', () => {
  it('renders hero + latest + trace + timeline', async () => {
    // Return the film only for the film endpoint; every other endpoint (latest
    // investigation, runs, cached triple) 404s so the panel falls through to
    // its empty "no run yet" state instead of treating the film payload as a
    // fake investigation triple.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/\/catalog\/films\/42(?:$|\?)/.test(url)) {
        return { ok: true, json: async () => film }
      }
      return { ok: false, status: 404, json: async () => null }
    }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/movies/42']}>
          <Routes><Route path="/movies/:filmId" element={<MovieDetailRoute />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument())
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument()
    // Both the PersistentAgentTrace wrapper heading and the inner AgentTrace label say "Agent Trace"
    expect(screen.getAllByText(/agent trace/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/past runs/i)).toBeInTheDocument()
  })
})
