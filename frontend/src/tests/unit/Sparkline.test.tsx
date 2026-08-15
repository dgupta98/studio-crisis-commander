import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkline } from '@/components/Sparkline'

describe('Sparkline', () => {
  it('renders SVG when data present', () => {
    const data = [
      { ts: 't1', value: 10 }, { ts: 't2', value: 20 }, { ts: 't3', value: 15 },
    ]
    const { container } = render(<Sparkline data={data} label="Sentiment" />)
    // Recharts renders an SVG root
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Sentiment')).toBeInTheDocument()
  })

  it('renders empty placeholder when no data', () => {
    render(<Sparkline data={[]} label="Empty" />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })
})
