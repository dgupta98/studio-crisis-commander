import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LatencyBadge } from '../../components/LatencyBadge'

describe('LatencyBadge', () => {
  it('formats ms under 1s', () => {
    render(<LatencyBadge ms={347} />)
    expect(screen.getByText('347ms')).toBeInTheDocument()
  })
  it('formats seconds when >=1000ms', () => {
    render(<LatencyBadge ms={2500} />)
    expect(screen.getByText('2.5s')).toBeInTheDocument()
  })
  it('renders em-dash when null', () => {
    render(<LatencyBadge ms={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
