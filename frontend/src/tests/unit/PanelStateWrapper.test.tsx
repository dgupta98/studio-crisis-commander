import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'

describe('PanelStateWrapper', () => {
  it('renders children when state.kind=success', () => {
    render(
      <PanelStateWrapper state={{ kind: 'success' }} label="Test">
        <div>real content</div>
      </PanelStateWrapper>,
    )
    expect(screen.getByText('real content')).toBeInTheDocument()
  })

  it('renders skeleton + substatus on loading', () => {
    render(
      <PanelStateWrapper state={{ kind: 'loading', substatus: 'Querying…' }} label="Test">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.getByText('Querying…')).toBeInTheDocument()
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
  })

  it('renders idle placeholder — no children', () => {
    render(
      <PanelStateWrapper state={{ kind: 'idle' }} label="Anomaly Feed" idleLabel="Waiting">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting/)).toBeInTheDocument()
  })

  it('renders empty hint', () => {
    render(
      <PanelStateWrapper state={{ kind: 'empty', hint: 'Nothing yet' }} label="X">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
  })

  it('renders error + calls retry on click', () => {
    const retry = vi.fn()
    render(
      <PanelStateWrapper state={{ kind: 'error', message: 'Boom', retry }} label="X">
        <div>hidden</div>
      </PanelStateWrapper>,
    )
    expect(screen.getByText('Boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
