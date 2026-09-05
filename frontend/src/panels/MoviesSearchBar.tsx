import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const BASE = import.meta.env.VITE_API_URL || ''

interface Hit { id: number; title: string; poster_url: string }

export function MoviesSearchBar() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${BASE}/catalog/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        setHits(await r.json())
      } catch { /* aborted */ }
    }, 200)
    return () => { ctrl.abort(); clearTimeout(t) }
  }, [q])

  return (
    <div className="relative w-full max-w-md">
      <input
        aria-label="Search movies"
        placeholder="Search movies…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm placeholder:text-ink-soft focus:border-accent focus:outline-none"
      />
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-card shadow-lg">
          {hits.slice(0, 8).map((h) => (
            <li key={h.id}>
              <Link
                to={`/movies/${h.id}`}
                onClick={() => setQ('')}
                className="block px-3 py-2 text-xs hover:bg-card-alt"
              >
                {h.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
