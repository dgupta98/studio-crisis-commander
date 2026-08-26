import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FilmPicker } from '@/components/FilmPicker'
import * as queries from '@/api/queries'

function wrap(child: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{child}</QueryClientProvider>
}

describe('FilmPicker', () => {
  it('opens the panel when clicked', () => {
    render(wrap(<FilmPicker currentFilmId={null} currentTitle={null} onPick={() => {}} />))
    fireEvent.click(screen.getByRole('button', { name: /change film/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('calls onPick with (id, title) when a film is chosen', async () => {
    vi.spyOn(queries.queries, 'shelves').mockReturnValue({
      queryKey: ['shelves', null],
      queryFn: async () => ([{
        id: 's', title: 'S', films: [
          { id: 42, title: 'Foo' }, { id: 7, title: 'Bar' },
        ],
      }]),
    } as any)
    const onPick = vi.fn()
    render(wrap(<FilmPicker currentFilmId={null} currentTitle={null} onPick={onPick} />))
    fireEvent.click(screen.getByRole('button', { name: /change film/i }))
    await waitFor(() => screen.getByText('Foo'))
    fireEvent.mouseDown(screen.getByText('Foo'))
    expect(onPick).toHaveBeenCalledWith(42, 'Foo')
  })
})
