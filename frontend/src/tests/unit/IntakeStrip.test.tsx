import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IntakeStrip } from '../../panels/IntakeStrip'
import { useSignalStore } from '../../store/signalStore'

// Stub the hook so tests don't try to open a real EventSource
vi.mock('../../hooks/useIntakeRates', () => ({
  useIntakeRates: () => {},
}))

describe('IntakeStrip', () => {
  beforeEach(() => {
    useSignalStore.setState({
      rates: { box_office: 12, social: 34, reviews: 5, streaming: 8 },
      history: { box_office: [10, 12], social: [30, 34], reviews: [4, 5], streaming: [7, 8] },
    })
  })

  it('renders 4 family counters without divider lines', () => {
    render(<IntakeStrip />)

    const strip = screen.getByTestId('intake-strip')
    expect(strip).not.toHaveClass('border-b')
    expect(strip).not.toHaveClass('border-line')

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })
})
