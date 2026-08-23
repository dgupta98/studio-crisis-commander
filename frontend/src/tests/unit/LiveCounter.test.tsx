import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveCounter } from '../../landing/LiveCounter'

beforeEach(() => {
  // queries.ts BASE() throws when VITE_API_URL is unset — required for queryFn
  // to reach the stubbed fetch instead of erroring immediately.
  vi.stubEnv('VITE_API_URL', 'http://test.local')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('LiveCounter', () => {
  it('renders rollup values from /stats/summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({
        films_tracked: 250, regions: 15, days_history: 120, rows_scanned_24h: 1234567, p50_detection_ms: 340,
      }),
    })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><LiveCounter /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByText(/250/)).toBeInTheDocument())
    expect(screen.getByText(/15/)).toBeInTheDocument()
    expect(screen.getByText(/120/)).toBeInTheDocument()

    const compactValue = screen.getByText('1.2')
    const suffix = screen.getByText('M')

    expect(compactValue).toHaveClass('whitespace-nowrap')
    expect(compactValue).toHaveClass('overflow-visible')
    expect(suffix).toHaveClass('translate-y-[-0.12em]')
    expect(suffix).toHaveClass('text-[0.38em]')
  })
})
