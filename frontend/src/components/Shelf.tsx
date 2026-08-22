import type { CatalogFilm } from '../store/catalogStore'
import { MovieCard } from './MovieCard'

interface Props {
  title: string
  films: CatalogFilm[]
  variant?: 'data' | 'slim'
}

export function Shelf({ title, films, variant = 'data' }: Props) {
  return (
    <section className="flex flex-col gap-2">
<<<<<<< HEAD
      <h3 className="px-4 font-body text-sm font-semibold tracking-tight text-ink">{title}</h3>
=======
      <h3 className="px-4 font-display text-sm font-semibold tracking-tight text-ink">{title}</h3>
>>>>>>> 5625b8c (font changes)
      {films.length === 0 ? (
        <div className="px-4 text-xs text-ink-soft">No films yet.</div>
      ) : (
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scrollbar-thin"
          style={{ scrollbarWidth: 'thin' }}
        >
          {films.map((f) => (
            <div key={f.id} className="snap-start">
              <MovieCard film={f} variant={variant} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
