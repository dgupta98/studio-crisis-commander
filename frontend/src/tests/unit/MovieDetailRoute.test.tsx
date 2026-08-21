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
  it('renders hero + latest + trace + timeline + telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => film })))
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
    expect(screen.getByText(/signals \(last 7d\)/i)).toBeInTheDocument()
  })
})
