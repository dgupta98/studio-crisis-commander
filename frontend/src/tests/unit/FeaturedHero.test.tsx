import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FeaturedHero } from '../../components/FeaturedHero'

const films = [
  { id: 1, title: 'Alpha', poster_url: 'a.jpg', featured: true },
  { id: 2, title: 'Bravo', poster_url: 'b.jpg', featured: true },
  { id: 3, title: 'Charlie', poster_url: 'c.jpg', featured: true },
]

describe('FeaturedHero', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows first film initially', () => {
    render(<MemoryRouter><FeaturedHero films={films as any} /></MemoryRouter>)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('rotates every 6s', () => {
    render(<MemoryRouter><FeaturedHero films={films as any} /></MemoryRouter>)
    act(() => { vi.advanceTimersByTime(6100) })
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('links CTA to detail', () => {
    render(<MemoryRouter><FeaturedHero films={films as any} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /replay investigation/i })).toHaveAttribute('href', '/movies/1')
  })
})
