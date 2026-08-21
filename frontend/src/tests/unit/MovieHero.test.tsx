import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { MovieHero } from '../../panels/MovieHero'

const film = {
  id: 42, title: 'Test Title', poster_url: 'x.jpg', release_date: '2025-01-01',
  popularity: 42.5, signals: { box_office: 10, social: 20, reviews: 5, streaming: 8 },
  featured: true, cached_scenario_id: 'sc_001',
}

describe('MovieHero', () => {
  it('renders title, release, and inject CTA', () => {
    render(<MemoryRouter><MovieHero film={film as any} onInject={() => {}} /></MemoryRouter>)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText(/2025/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inject crisis/i })).toBeInTheDocument()
  })

  it('badges featured with cached scenario id', () => {
    render(<MemoryRouter><MovieHero film={film as any} onInject={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/sc_001/i)).toBeInTheDocument()
  })

  it('inject CTA fires callback', () => {
    const cb = vi.fn()
    render(<MemoryRouter><MovieHero film={film as any} onInject={cb} /></MemoryRouter>)
    screen.getByRole('button', { name: /inject crisis/i }).click()
    expect(cb).toHaveBeenCalled()
  })
})
