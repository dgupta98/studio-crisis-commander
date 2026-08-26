import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimeseriesGrid } from '@/panels/TimeseriesGrid'
import { useRunStore } from '@/store/runStore'

describe('TimeseriesGrid', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('renders nothing when no film selected', () => {
    const { container } = render(<TimeseriesGrid />)
    expect(container.querySelector('[data-testid="timeseries-grid"]')).toBeNull()
  })

  it('prompts to pick a region when film chosen but region null', () => {
    useRunStore.getState().pickFilm(1)
    render(<TimeseriesGrid />)
    expect(screen.getByText(/Pick a region/i)).toBeInTheDocument()
  })

  it('renders 4 sparkline labels when both are chosen', () => {
    useRunStore.getState().pickFilm(1)
    useRunStore.getState().pickRegion('Brazil')
    render(<TimeseriesGrid />)
    expect(screen.getByText('Box office')).toBeInTheDocument()
    expect(screen.getByText('Social')).toBeInTheDocument()
    expect(screen.getByText('Sentiment')).toBeInTheDocument()
    expect(screen.getByText('Trailer')).toBeInTheDocument()
  })
})
