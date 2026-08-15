import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '@/App'

describe('OpsCenter layout', () => {
  it('renders all 7 panel regions by test-id', () => {
    render(<App />)
    for (const id of [
      'hero', 'telemetry', 'trace', 'anomaly',
      'recommendation', 'approval', 'inject', 'history',
    ]) {
      expect(screen.getByTestId(`panel-${id}`)).toBeInTheDocument()
    }
  })

  it('has no horizontal scroll (main container has overflow-x-hidden)', () => {
    render(<App />)
    const main = screen.getByTestId('ops-center')
    expect(main.className).toContain('overflow-x-hidden')
  })
})
