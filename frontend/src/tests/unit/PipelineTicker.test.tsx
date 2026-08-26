import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineTicker } from '@/panels/PipelineTicker'
import { useRunStore } from '@/store/runStore'

describe('PipelineTicker', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('is hidden when no active runs', () => {
    const { container } = render(<PipelineTicker />)
    expect(container.querySelector('[data-testid="pipeline-ticker"]')).toBeNull()
  })

  it('shows one run when one is registered', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 1, region: 'Brazil' })
    render(<PipelineTicker />)
    expect(screen.getByTestId('pipeline-ticker')).toBeInTheDocument()
    expect(screen.getByText('Brazil')).toBeInTheDocument()
  })

  it('lets user focus another run', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 1, region: 'Brazil' })
    useRunStore.getState()._registerRun('r_2', { filmId: 1, region: 'Japan' })
    render(<PipelineTicker />)
    fireEvent.click(screen.getByText('Japan'))
    expect(useRunStore.getState().focusedRunId).toBe('r_2')
  })
})
