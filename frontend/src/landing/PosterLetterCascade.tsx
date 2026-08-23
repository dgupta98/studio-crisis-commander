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
  const seenIds = new Set<number>()
  const out: Item[] = []
  // Dedupe on film id only — repeating the same initial with a different
  // poster is desirable at this density (18 items). Skipping-by-letter
  // would starve the cascade well before we hit `count`.
  for (const shelf of shelves) {
    for (const f of shelf.films ?? []) {
      if (!f.poster_url || seenIds.has(f.id)) continue
      const l = initial(f.title)
      if (!l) continue
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
  { left: '3%',  size: 'clamp(70px,  8vw,  140px)', dur: 30, delay: -3,  rot: 10  },
  { left: '11%', size: 'clamp(55px,  6vw,  110px)', dur: 38, delay: -14, rot: -14 },
  { left: '18%', size: 'clamp(80px,  9vw,  160px)', dur: 32, delay: -22, rot: 16  },
  { left: '25%', size: 'clamp(60px,  7vw,  120px)', dur: 42, delay: -6,  rot: -8  },
  { left: '32%', size: 'clamp(75px, 8.5vw, 150px)', dur: 34, delay: -28, rot: 18  },
  { left: '39%', size: 'clamp(55px,  6vw,  110px)', dur: 40, delay: -10, rot: -12 },
  { left: '46%', size: 'clamp(80px,  9vw,  160px)', dur: 36, delay: -19, rot: 14  },
  { left: '53%', size: 'clamp(60px, 6.5vw, 120px)', dur: 44, delay: -33, rot: -20 },
  { left: '60%', size: 'clamp(70px,  8vw,  140px)', dur: 32, delay: -8,  rot: 12  },
  { left: '67%', size: 'clamp(55px,  6vw,  110px)', dur: 38, delay: -25, rot: -16 },
  { left: '74%', size: 'clamp(80px,  9vw,  160px)', dur: 30, delay: -12, rot: 20  },
  { left: '81%', size: 'clamp(60px, 6.5vw, 125px)', dur: 42, delay: -30, rot: -10 },
  { left: '88%', size: 'clamp(75px, 8.5vw, 145px)', dur: 34, delay: -16, rot: 14  },
  { left: '95%', size: 'clamp(55px,  6vw,  110px)', dur: 40, delay: -4,  rot: -18 },
  { left: '15%', size: 'clamp(50px, 5.5vw, 100px)', dur: 46, delay: -20, rot: 22  },
  { left: '42%', size: 'clamp(50px, 5.5vw, 100px)', dur: 48, delay: -36, rot: -22 },
  { left: '70%', size: 'clamp(50px, 5.5vw, 100px)', dur: 44, delay: -2,  rot: 8   },
  { left: '85%', size: 'clamp(50px, 5.5vw, 100px)', dur: 50, delay: -26, rot: -6  },
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
            initial={{ y: -8, rotate: 0, opacity: 0.18 }}
            animate={{ y: '140vh', rotate: lane.rot, opacity: 0.26 }}
            transition={{
              duration: lane.dur,
              delay: lane.delay,
              ease: 'easeInOut',
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
                opacity: 0.13,
                filter: 'contrast(1.1) saturate(1.15) drop-shadow(0 0 18px rgba(212,50,74,0.18))',
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
