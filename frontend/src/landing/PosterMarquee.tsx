import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { tokens } from '../theme/tokens'

interface Card {
  id: number
  title: string
  poster_url: string
  featured?: boolean
}

interface Shelf {
  id: string
  title: string
  films: Card[]
}

export function PosterMarquee() {
  const reduced = useReducedMotion()
  const { data, isPending } = useQuery({
    ...queries.shelves(null),
    staleTime: 5 * 60_000,
  }) as { data?: Shelf[]; isPending: boolean }

  const posters = collect(data)
  // While the query is in-flight (Cloud Run cold-start can add ~5s), render a
  // row of skeleton tiles so the marquee's slot on the page is preserved and
  // the user sees "content coming" instead of an empty gap.
  if (posters.length === 0) {
    if (!isPending) return null
    return (
      <div className="relative w-full overflow-hidden py-4">
        <div className="flex gap-6 px-6" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-64 w-44 flex-shrink-0 animate-pulse rounded-lg border border-line bg-card-alt md:h-72 md:w-48"
            />
          ))}
        </div>
      </div>
    )
  }

  // Duplicate for seamless loop.
  const loop = [...posters, ...posters]

  return (
    <div className="relative w-full overflow-hidden py-4">
      {/* Edge fades. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-48"
        style={{ background: `linear-gradient(90deg, ${tokens.color.paper} 0%, transparent 100%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-48"
        style={{ background: `linear-gradient(270deg, ${tokens.color.paper} 0%, transparent 100%)` }}
      />

      <div
        className={reduced ? 'flex gap-6 overflow-x-auto px-6' : 'flex gap-6 marquee-track'}
        style={reduced ? undefined : { width: 'max-content' }}
      >
        {loop.map((p, i) => (
          <PosterTile key={`${p.id}-${i}`} card={p} />
        ))}
      </div>

      {/* Marquee keyframes; only injected once because Tailwind can't express this without config. */}
      <style>{`
        @keyframes marquee-scroll {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        .marquee-track {
          animation: marquee-scroll 80s linear infinite;
        }
        .marquee-track:hover { animation-play-state: paused; }
      `}</style>
    </div>
  )
}

function PosterTile({ card }: { card: Card }) {
  return (
    <Link
      to={`/movies/${card.id}`}
      className="group relative block h-64 w-44 flex-shrink-0 overflow-hidden rounded-lg border border-line bg-card-alt shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] transition-transform hover:-translate-y-2 hover:border-accent md:h-72 md:w-48"
      title={`Open ${card.title}`}
    >
      {card.poster_url ? (
        <img
          src={card.poster_url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs leading-tight text-ink-soft">
          {card.title}
        </div>
      )}
      {card.featured && (
        <span className="absolute left-2 top-2 rounded bg-accent/85 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-widest text-white">
          Featured
        </span>
      )}
      {/* Hover overlay — surfaces the click affordance since the marquee is
          always animating and a naked cursor change is easy to miss. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-between gap-1.5 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 py-2 transition-transform duration-300 group-hover:translate-y-0">
        <span className="truncate font-display text-[12px] font-semibold text-white">
          {card.title}
        </span>
        <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-widest text-accent">
          Open →
        </span>
      </div>
    </Link>
  )
}

// Ordering: featured films first (so the visible slice showcases them),
// then the rest. Falls back to placeholders if the shelves API returned
// too few posters — keeps the row from looking empty on cold start.
function collect(shelves: Shelf[] | undefined): Card[] {
  if (!shelves) return []
  const featuredShelf = shelves.find((s) => s.id === 'featured')
  const featuredIds = new Set<number>((featuredShelf?.films ?? []).map((f) => f.id))
  const out: Card[] = []
  const seen = new Set<number>()

  // 1. Featured shelf first, in the order the backend ranked them.
  for (const f of featuredShelf?.films ?? []) {
    if (seen.has(f.id) || !f.poster_url) continue
    out.push({ id: f.id, title: f.title, poster_url: f.poster_url, featured: true })
    seen.add(f.id)
  }
  // 2. Everything else with a poster.
  for (const s of shelves) {
    if (s.id === 'featured') continue
    for (const f of s.films) {
      if (seen.has(f.id) || !f.poster_url) continue
      out.push({ id: f.id, title: f.title, poster_url: f.poster_url, featured: featuredIds.has(f.id) })
      seen.add(f.id)
      if (out.length >= 24) return out
    }
  }
  // 3. Placeholder backfill so the row is never bare.
  if (out.length < 8) {
    for (const s of shelves) {
      for (const f of s.films) {
        if (seen.has(f.id)) continue
        out.push({ id: f.id, title: f.title, poster_url: '', featured: featuredIds.has(f.id) })
        seen.add(f.id)
        if (out.length >= 12) return out
      }
    }
  }
  return out
}
