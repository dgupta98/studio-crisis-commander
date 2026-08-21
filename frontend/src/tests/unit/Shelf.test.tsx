import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { Shelf } from '../../components/Shelf'

const films = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `F${i + 1}`,
  poster_url: '',
}))

describe('Shelf', () => {
  it('renders shelf title and all cards', () => {
    render(
      <MemoryRouter>
        <Shelf title="Featured" films={films as any} />
      </MemoryRouter>
    )
    expect(screen.getByText('Featured')).toBeInTheDocument()
    for (const f of films) expect(screen.getByText(f.title)).toBeInTheDocument()
  })

  it('renders empty state when no films', () => {
    render(
      <MemoryRouter>
        <Shelf title="Empty" films={[]} />
      </MemoryRouter>
    )
    expect(screen.getByText(/no films yet/i)).toBeInTheDocument()
  })
})
