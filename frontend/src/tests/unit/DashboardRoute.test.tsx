import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, beforeEach } from 'vitest'
import DashboardRoute from '../../routes/DashboardRoute'
import { useRunStore } from '../../store/runStore'

function renderRoute(initialEntries: string[] = ['/dashboard']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <DashboardRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardRoute', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('mounts MovieCommand empty prompt + TraceDrawer tab on cold load', () => {
    renderRoute()
    expect(screen.getByTestId('route-dashboard')).toBeInTheDocument()
    // Empty MovieCommand shows a pick-a-movie prompt when no film selected;
    // pin the assertion to that specific copy so we don't collide with the
    // InvestigationView empty state ("Pick a movie on the heat bar…").
    expect(screen.getByText(/Pick a movie to see its regional performance/i)).toBeInTheDocument()
    // Trace drawer's vertical tab is always mounted.
    expect(screen.getByRole('button', { name: /Show agent trace/i })).toBeInTheDocument()
  })
})

describe('DashboardRoute deep-link hydration', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('hydrates selectedFilmId + selectedRegion from URL', () => {
    renderRoute(['/dashboard?film=42&region=Brazil'])
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBe(42)
    expect(s.selectedRegion).toBe('Brazil')
  })
})
