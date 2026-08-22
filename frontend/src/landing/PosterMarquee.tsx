import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { tokens } from '../theme/tokens'

interface Card {
  id: number
  title: string
  poster_url: string
}

interface Shelf {
  id: string
  title: string
  films: Card[]
}

export function PosterMarquee() {
  const reduced = useReducedMotion()
  const { data } = useQuery({
    ...queries.shelves(null),
    staleTime: 5 * 60_000,
  }) as { data?: Shelf[] }

  const posters = collect(data)
  if (posters.length === 0) return null

  // Duplicate for seamless loop.
  const loop = [...posters, ...posters]

  return (
    <div className="relative w-full overflow-hidden py-2">
      {/* Edge fades. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32"
        style={{ background: `linear-gradient(90deg, ${tokens.color.paper} 0%, transparent 100%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32"
        style={{ background: `linear-gradient(270deg, ${tokens.color.paper} 0%, transparent 100%)` }}
      />

      <div
        className={reduced ? 'flex gap-4 overflow-x-auto px-6' : 'flex gap-4 marquee-track'}
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
    <div
      className="relative h-40 w-28 flex-shrink-0 overflow-hidden rounded-md border border-line bg-card-alt shadow-[0_10px_30px_-15px_rgba(0,0,0,0.8)] transition-transform hover:-translate-y-1"
      title={card.title}
    >
      {card.poster_url ? (
        <img
          src={card.poster_url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] leading-tight text-ink-soft">
          {card.title}
        </div>
      )}
    </div>
  )
}

function collect(shelves: Shelf[] | undefined): Card[] {
  if (!shelves) return []
  const out: Card[] = []
  const seen = new Set<number>()
  for (const s of shelves) {
    for (const f of s.films) {
      if (seen.has(f.id)) continue
      // Prefer entries with a poster so the row looks intentional.
      if (!f.poster_url) continue
      out.push({ id: f.id, title: f.title, poster_url: f.poster_url })
      seen.add(f.id)
      if (out.length >= 24) return out
    }
  }
  // If we didn't get enough posters, backfill with placeholders so the row isn't empty.
  if (out.length < 8) {
    for (const s of shelves) {
      for (const f of s.films) {
        if (seen.has(f.id)) continue
        out.push({ id: f.id, title: f.title, poster_url: '' })
        seen.add(f.id)
        if (out.length >= 12) return out
      }
    }
  }
  return out
}
