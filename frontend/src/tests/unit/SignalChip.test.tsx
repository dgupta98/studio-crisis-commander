import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SignalChip } from '../../components/SignalChip'

describe('SignalChip', () => {
  it('renders the family label', () => {
    render(<SignalChip family="box_office" />)
    expect(screen.getByText(/box office/i)).toBeInTheDocument()
  })
  it('exposes the family via data-family for downstream selectors', () => {
    render(<SignalChip family="social" data-testid="chip" />)
    expect(screen.getByTestId('chip')).toHaveAttribute('data-family', 'social')
  })
})
