import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CatalogFilm } from '../store/catalogStore'
import { regionAbbrev } from '@/lib/regions'

interface Props {
  film: CatalogFilm
  variant?: 'data' | 'slim'
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 3) return <span className="text-emerald-400">▲</span>
  if (delta < -3) return <span className="text-accent">▼</span>
  return <span className="text-ink-soft">─</span>
}

export function MovieCard({ film, variant = 'data' }: Props) {
  const [hover, setHover] = useState(false)
  const navigate = useNavigate()
  const isData = variant === 'data'
  const strip = (film.top_regions ?? []).slice(0, hover ? 6 : 3)

  // DashboardRoute hydrates selectedFilmId/selectedRegion from these URL
  // params on mount (Task 2.6), so pushing to the route is enough — no
  // store side-channel needed (which would violate the components boundary
  // rule anyway).
  const goDashboard = (region?: string) => {
    navigate(`/dashboard?film=${film.id}${region ? `&region=${encodeURIComponent(region)}` : ''}`)
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative flex w-40 flex-shrink-0 flex-col overflow-hidden rounded-md border border-line bg-card transition-transform hover:-translate-y-0.5 hover:border-accent"
    >
      <Link to={`/movies/${film.id}`} className="block">
        <div className="relative aspect-[2/3] overflow-hidden bg-card-alt">
          {film.poster_url ? (
            <img src={film.poster_url} alt="" loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">no poster</div>
          )}
          {film.featured && (
            <span className="absolute left-1 top-1 rounded bg-accent/90 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-white">
              Featured
            </span>
          )}
          {film.open_investigation && (
            <span
              aria-label="Open investigation"
              className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent shadow-lg"
            />
          )}
        </div>
        <div className="flex flex-col gap-1 p-2">
          <div className="truncate text-xs font-medium">{film.title}</div>
          {isData && film.signal_delta ? (
            <div className="text-[10px] font-mono text-ink-soft">
              Δ {film.signal_delta.toFixed(2)}
            </div>
          ) : null}
        </div>
      </Link>
      {isData && strip.length > 0 && (
        <div className="grid gap-1 border-t border-line p-2 transition-all"
          style={{ gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))` }}>
          {strip.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={(e) => { e.preventDefault(); goDashboard(r.code) }}
              className="flex flex-col items-center gap-0.5 rounded bg-card-alt px-1 py-1 hover:border-accent"
              title={`${r.code} ${r.delta_pct >= 0 ? '+' : ''}${r.delta_pct}%`}
            >
              <span className="font-mono text-[8px] uppercase tracking-wider text-ink-soft">
                {regionAbbrev(r.code)}
              </span>
              <span className="text-[9px]"><DeltaArrow delta={r.delta_pct} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
