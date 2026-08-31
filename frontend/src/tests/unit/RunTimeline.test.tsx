import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RunTimeline } from '../../panels/RunTimeline'

const runs = [
  { run_id: 'r1', at: '2026-08-16T00:00:00Z', ctype: 'box_office_drop', magnitude: 0.4, severity: 'high' },
  { run_id: 'r2', at: '2026-08-14T00:00:00Z', ctype: 'social_meltdown', magnitude: 0.3, severity: 'medium' },
]

describe('RunTimeline', () => {
  it('renders each past run', () => {
    render(<RunTimeline filmId={1} runs={runs as any} />)
    expect(screen.getByText(/box_office_drop/i)).toBeInTheDocument()
    expect(screen.getByText(/social_meltdown/i)).toBeInTheDocument()
  })
  it('shows empty state', () => {
    render(<RunTimeline filmId={1} runs={[]} />)
    expect(screen.getByText(/no past runs/i)).toBeInTheDocument()
  })
})
