import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import type { CatalogFilm } from '../store/catalogStore'

interface Props {
  films: CatalogFilm[]
  intervalMs?: number
}

export function FeaturedHero({ films, intervalMs = 6000 }: Props) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (films.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % films.length), intervalMs)
    return () => clearInterval(t)
  }, [films.length, intervalMs])

  if (!films.length) return null
  const film = films[idx]

  return (
    <div className="relative flex h-[45vh] w-full items-end overflow-hidden bg-black">
      <AnimatePresence mode="wait">
        <motion.img
          key={film.id}
          src={film.poster_url}
          alt=""
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 0.5, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-paper via-paper/60 to-transparent" />
      <div className="relative z-10 flex max-w-2xl flex-col gap-3 p-8">
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent w-fit">
          Featured investigation
        </span>
        <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-ink">{film.title}</h2>
        <Link
          to={`/movies/${film.id}`}
          className="w-fit rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20"
        >
          Replay investigation →
        </Link>
      </div>
    </div>
  )
}
