import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import MoviesRoute from '../../routes/MoviesRoute'
import { useCatalogStore } from '../../store/catalogStore'

const shelves = [
  { id: 'featured', title: 'Featured', films: [{ id: 1, title: 'Alpha', poster_url: '', featured: true }] },
  { id: 'trending', title: 'Trending', films: [{ id: 2, title: 'Bravo', poster_url: '' }] },
]

beforeEach(() => {
  // queries.ts BASE() throws when VITE_API_URL is unset — required for queryFn
  // to reach the stubbed fetch instead of erroring immediately.
  vi.stubEnv('VITE_API_URL', 'http://test.local')
  useCatalogStore.setState({ shelves: [], films: {}, region: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('MoviesRoute', () => {
  it('renders shelves from /catalog/shelves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => shelves })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MoviesRoute />
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 3, name: 'Featured' })).toBeInTheDocument()
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Trending' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search films')).toBeInTheDocument()
  })
})
