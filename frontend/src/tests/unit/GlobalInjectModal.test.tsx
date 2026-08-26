import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { GlobalInjectModal } from '../../shell/GlobalInjectModal'
import { useRunStore } from '../../store/runStore'

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
    // MultiRegionPicker seeds with NA chip; grabbing the Remove button proves the chip rendered.
    expect(screen.getByLabelText('Remove NA')).toBeInTheDocument()
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
  it('submits a multi-region inject when 2+ regions are picked', async () => {
    const inject = vi.fn().mockResolvedValue(['r_a', 'r_b'])
    vi.spyOn(useRunStore.getState(), 'inject').mockImplementation(inject as any)
    renderWithClient(<GlobalInjectModal open onClose={() => {}} />)
    // Type a numeric id so the `/^\d+$/.test(trimmed)` fallback resolves the film.
    fireEvent.change(screen.getByLabelText('Movie'), { target: { value: '1' } })
    // Regions default to ['NA'] — add Brazil via the picker:
    fireEvent.click(screen.getByText('+ Add region ▾'))
    fireEvent.mouseDown(screen.getByText('Brazil'))
    fireEvent.click(screen.getByRole('button', { name: /^Inject$/i }))
    await waitFor(() => expect(inject).toHaveBeenCalled())
    const call = inject.mock.calls[0][0]
    expect(call.regions).toEqual(expect.arrayContaining(['NA', 'Brazil']))
  })
})
