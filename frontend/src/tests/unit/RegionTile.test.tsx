import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RegionTile } from '@/components/RegionTile'
import type { RegionSummary } from '@/api/contracts'

const mkRegion = (over: Partial<RegionSummary> = {}): RegionSummary => ({
  code: 'Brazil',
  signals: {
    box_office: { volume: 100, delta_pct: 5, anomaly: false },
    social:     { volume: 200, delta_pct: -30, anomaly: true },
    reviews:    { volume:  50, delta_pct: 0,  anomaly: false },
    streaming:  { volume: 400, delta_pct: 8,  anomaly: false },
  },
  open_investigation: false,
  ...over,
})

const SCALE = { box_office: 1000, social: 1000, reviews: 1000, streaming: 1000 }

describe('RegionTile', () => {
  it('renders abbreviated code', () => {
    render(<RegionTile region={mkRegion()} selected={false} activeRun={false}
      onClick={() => {}} volumeScale={SCALE} />)
    expect(screen.getByText('BRA')).toBeInTheDocument()
  })

  it('emits click with region code', () => {
    const onClick = vi.fn()
    render(<RegionTile region={mkRegion()} selected={false} activeRun={false}
      onClick={onClick} volumeScale={SCALE} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledWith('Brazil')
  })

  it('shows aria-pressed when selected', () => {
    render(<RegionTile region={mkRegion()} selected={true} activeRun={false}
      onClick={() => {}} volumeScale={SCALE} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders open-investigation dot', () => {
    const { container } = render(
      <RegionTile region={mkRegion({ open_investigation: true })}
        selected={false} activeRun={false}
        onClick={() => {}} volumeScale={SCALE} />
    )
    // The dot is aria-hidden; identify via its class.
    expect(container.querySelector('.bg-accent.rounded-full')).toBeTruthy()
  })
})
