import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceDrawer } from '@/panels/TraceDrawer'
import { useRunStore } from '@/store/runStore'

describe('TraceDrawer', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('starts closed', () => {
    render(<TraceDrawer />)
    expect(screen.queryByLabelText('Close trace drawer')).not.toBeInTheDocument()
  })

  it('opens when the vertical tab is clicked', () => {
    render(<TraceDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /Show agent trace/i }))
    expect(screen.getByLabelText('Close trace drawer')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<TraceDrawer />)
    fireEvent.click(screen.getByRole('button', { name: /Show agent trace/i }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('Close trace drawer')).not.toBeInTheDocument()
  })
})
