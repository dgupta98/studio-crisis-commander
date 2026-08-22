import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'
import { useReducedMotion } from '../hooks/useReducedMotion'

/**
 * Falling poster-letters — each film title's initial glyph clipped inside
 * its own poster image, drifting down and rotating slowly behind the hero.
 *
 * Rendered at z-index 0 (below headline/telemetry content at z-10, above the
 * particle canvas at -z-10). `mix-blend-mode: screen` brightens the dark
 * background instead of layering pixel-over-pixel, so foreground text stays
 * crisp even where a letter passes behind it.
 *
 * `aria-hidden` and `pointer-events-none` — pure decoration.
 */

type ShelfFilm = { id: number; title: string; poster_url: string }
type Shelf = { films: ShelfFilm[] }

interface Item {
  key: string
  letter: string
  poster: string
  title: string
}

const SKIP_PREFIXES = ['the ', 'a ', 'an ']

function initial(title: string): string {
  const t = title.trim()
  if (!t) return ''
  const lower = t.toLowerCase()
  for (const p of SKIP_PREFIXES) {
    if (lower.startsWith(p)) return t.slice(p.length, p.length + 1).toUpperCase()
  }
  return t.slice(0, 1).toUpperCase()
}

function pickItems(shelves: Shelf[] | undefined, count: number): Item[] {
  if (!shelves) return []
  const seenLetters = new Set<string>()
  const seenIds = new Set<number>()
  const out: Item[] = []
  for (const shelf of shelves) {
    for (const f of shelf.films ?? []) {
      if (!f.poster_url || seenIds.has(f.id)) continue
      const l = initial(f.title)
      if (!l || seenLetters.has(l)) continue
      seenLetters.add(l)
      seenIds.add(f.id)
      out.push({ key: `${f.id}-${l}`, letter: l, poster: f.poster_url, title: f.title })
      if (out.length >= count) return out
    }
  }
  return out
}

// Deterministic spread across the horizontal + varied durations, so the
// scene feels curated rather than random on each render.
const LANES = [
  { left: '6%',  size: 'clamp(160px, 20vw, 340px)', dur: 26, delay: -3,  rot: 12  },
  { left: '20%', size: 'clamp(140px, 16vw, 280px)', dur: 32, delay: -12, rot: -18 },
  { left: '33%', size: 'clamp(180px, 22vw, 380px)', dur: 28, delay: -22, rot: 15  },
  { left: '48%', size: 'clamp(140px, 17vw, 300px)', dur: 34, delay: -8,  rot: -10 },
  { left: '62%', size: 'clamp(170px, 21vw, 360px)', dur: 30, delay: -18, rot: 20  },
  { left: '76%', size: 'clamp(140px, 16vw, 280px)', dur: 36, delay: -5,  rot: -14 },
  { left: '88%', size: 'clamp(160px, 19vw, 320px)', dur: 29, delay: -25, rot: 8   },
  { left: '55%', size: 'clamp(120px, 14vw, 240px)', dur: 40, delay: -32, rot: -22 },
]

export function PosterLetterCascade() {
  const reduced = useReducedMotion()
  const { data } = useQuery(queries.shelves(null))
  const items = useMemo(() => pickItems(data as Shelf[] | undefined, LANES.length), [data])

  if (reduced || items.length === 0) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{ mixBlendMode: 'screen' }}
    >
      {items.map((item, i) => {
        const lane = LANES[i % LANES.length]
        return (
          <motion.div
            key={item.key}
            className="absolute -top-[35vh] select-none will-change-transform"
            style={{ left: lane.left }}
            initial={{ y: 0, rotate: 0 }}
            animate={{ y: '150vh', rotate: lane.rot }}
            transition={{
              duration: lane.dur,
              delay: lane.delay,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <span
              className="block font-display leading-none"
              style={{
                fontSize: lane.size,
                backgroundImage: `url("${item.poster}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                WebkitTextFillColor: 'transparent',
                opacity: 0.22,
                filter: 'contrast(1.15) saturate(1.25) drop-shadow(0 0 24px rgba(212,50,74,0.25))',
              }}
            >
              {item.letter}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}
