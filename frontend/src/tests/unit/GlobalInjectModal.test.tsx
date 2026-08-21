import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GlobalInjectModal } from '../../shell/GlobalInjectModal'

describe('GlobalInjectModal', () => {
  it('renders when open', () => {
    render(<GlobalInjectModal open onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Crisis type')).toBeInTheDocument()
    expect(screen.getByLabelText('Film ID')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toBeInTheDocument()
    expect(screen.getByLabelText('Magnitude')).toBeInTheDocument()
  })
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<GlobalInjectModal open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('does not render when closed', () => {
    render(<GlobalInjectModal open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
