import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { GlobalInjectModal } from '../../shell/GlobalInjectModal'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GlobalInjectModal', () => {
  it('renders when open', () => {
    renderWithClient(<GlobalInjectModal open onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Crisis type')).toBeInTheDocument()
    expect(screen.getByLabelText('Movie')).toBeInTheDocument()
    expect(screen.getByLabelText('Region')).toBeInTheDocument()
    expect(screen.getByLabelText('Magnitude')).toBeInTheDocument()
  })
  it('opens themed crisis-type dropdown on click and lists options', () => {
    renderWithClient(<GlobalInjectModal open onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Crisis type'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    // At least one known option renders as an <li role="option">.
    expect(screen.getByText('Refund spike')).toBeInTheDocument()
  })
  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderWithClient(<GlobalInjectModal open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('does not render when closed', () => {
    renderWithClient(<GlobalInjectModal open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
