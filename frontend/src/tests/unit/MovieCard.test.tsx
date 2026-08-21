import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { MovieCard } from '../../components/MovieCard'

const film = {
  id: 42,
  title: 'Test Film',
  poster_url: 'https://example.com/p.jpg',
  signal_delta: 3.2,
  region_hint: 'US',
  featured: true,
}

describe('MovieCard', () => {
  it('renders title, delta, region', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="data" /></MemoryRouter>)
    expect(screen.getByText('Test Film')).toBeInTheDocument()
    expect(screen.getByText(/3.2/)).toBeInTheDocument()
    expect(screen.getByLabelText('US')).toBeInTheDocument()
  })

  it('marks featured cards', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="data" /></MemoryRouter>)
    expect(screen.getByText(/featured/i)).toBeInTheDocument()
  })

  it('slim variant hides delta', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="slim" /></MemoryRouter>)
    expect(screen.queryByText(/3.2/)).not.toBeInTheDocument()
    expect(screen.getByText('Test Film')).toBeInTheDocument()
  })

  it('links to detail route', () => {
    render(<MemoryRouter><MovieCard film={film as any} variant="data" /></MemoryRouter>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/movies/42')
  })
})
