import { Link } from 'react-router-dom'
import { RegionFlag } from './RegionFlag'
import type { CatalogFilm } from '../store/catalogStore'

interface Props {
  film: CatalogFilm
  variant?: 'data' | 'slim'
}

export function MovieCard({ film, variant = 'data' }: Props) {
  const isData = variant === 'data'
  return (
    <Link
      to={`/movies/${film.id}`}
      className="group flex w-40 flex-shrink-0 flex-col overflow-hidden rounded-md border border-line bg-card transition-transform hover:-translate-y-0.5 hover:border-accent"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-card-alt">
        {film.poster_url ? (
          <img
            src={film.poster_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">no poster</div>
        )}
        {film.featured && (
          <span className="absolute left-1 top-1 rounded bg-accent/90 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-white">
            Featured
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-2">
        <div className="truncate text-xs font-medium">{film.title}</div>
        {isData && (film.signal_delta || film.region_hint) ? (
          <div className="flex items-center justify-between text-[10px] text-ink-soft">
            {film.signal_delta ? (
              <span className="font-mono">Δ {film.signal_delta.toFixed(2)}</span>
            ) : <span />}
            {film.region_hint && <RegionFlag region={film.region_hint} />}
          </div>
        ) : null}
      </div>
    </Link>
  )
}
