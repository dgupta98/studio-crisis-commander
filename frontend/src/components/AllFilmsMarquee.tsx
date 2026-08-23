import { Link } from 'react-router-dom'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { tokens } from '../theme/tokens'
import type { CatalogFilm } from '../store/catalogStore'

interface Props {
  title: string
  films: CatalogFilm[]
}

// Continuously-scrolling row of poster tiles, modeled on the landing
// PosterMarquee but with click-through to the movie detail route so it
// doubles as a browsable "All films" shelf. Duplicates the tile list once
// so the transform: translate3d(-50%) loop is seamless.
export function AllFilmsMarquee({ title, films }: Props) {
  const reduced = useReducedMotion()
  const tiles = films.filter((f) => f.poster_url)
  if (tiles.length === 0) return null

  const loop = [...tiles, ...tiles]

  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-4 font-display text-sm font-semibold tracking-tight text-ink">
        {title}
      </h3>
      <div className="relative w-full overflow-hidden py-2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 sm:w-24 md:w-32"
          style={{ background: `linear-gradient(90deg, ${tokens.color.paper} 0%, transparent 100%)` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 sm:w-24 md:w-32"
          style={{ background: `linear-gradient(270deg, ${tokens.color.paper} 0%, transparent 100%)` }}
        />

        <div
          className={
            reduced
              ? 'flex gap-3 overflow-x-auto px-4 sm:gap-4'
              : 'flex gap-3 all-films-track sm:gap-4'
          }
          style={reduced ? undefined : { width: 'max-content' }}
        >
          {loop.map((f, i) => (
            <MarqueeTile key={`${f.id}-${i}`} film={f} />
          ))}
        </div>

        <style>{`
          @keyframes all-films-scroll {
            from { transform: translate3d(0, 0, 0); }
            to   { transform: translate3d(-50%, 0, 0); }
          }
          .all-films-track {
            animation: all-films-scroll 120s linear infinite;
          }
          .all-films-track:hover { animation-play-state: paused; }
        `}</style>
      </div>
    </section>
  )
}

function MarqueeTile({ film }: { film: CatalogFilm }) {
  return (
    <Link
      to={`/movies/${film.id}`}
      title={film.title}
      className="group relative h-40 w-28 flex-shrink-0 overflow-hidden rounded-md border border-line bg-card-alt shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)] transition-transform hover:-translate-y-1 hover:border-accent sm:h-48 sm:w-32 md:h-56 md:w-40"
    >
      <img
        src={film.poster_url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2">
        <div className="truncate text-[11px] font-medium text-white">{film.title}</div>
      </div>
    </Link>
  )
}
