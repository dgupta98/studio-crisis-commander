import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'

interface FilmLite {
  id: number
  title: string
}

interface Props {
  currentFilmId: number | null
  currentTitle: string | null
  onPick: (id: number, title: string) => void
}

type Shelf = { id: string; title: string; films: FilmLite[] }

function flatten(shelves: Shelf[] | undefined): FilmLite[] {
  if (!shelves) return []
  const seen = new Map<number, string>()
  for (const s of shelves) for (const f of s.films ?? []) {
    if (!seen.has(f.id) && f.title) seen.set(f.id, f.title)
  }
  return Array.from(seen, ([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function FilmPicker({ currentFilmId, currentTitle, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const { data: shelvesRaw } = useQuery({
    ...queries.shelves(null),
    enabled: open,
  })
  const films = useMemo(() => flatten(shelvesRaw as Shelf[] | undefined), [shelvesRaw])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return films.slice(0, 40)
    return films.filter((f) => f.title.toLowerCase().includes(needle)).slice(0, 40)
  }, [films, q])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Change film"
        onClick={() => { setOpen((v) => !v); setQ('') }}
        className="rounded border border-line bg-card-alt px-3 py-1.5 text-xs uppercase tracking-wider text-ink hover:border-accent"
      >
        Film ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded border border-line bg-card p-2 shadow-2xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={films.length === 0 ? 'Loading catalog…' : 'Search films…'}
            disabled={films.length === 0}
            className="mb-2 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <ul role="listbox" className="max-h-64 overflow-auto">
            {filtered.map((f) => (
              <li key={f.id} role="option" aria-selected={f.id === currentFilmId}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onPick(f.id, f.title)
                    setOpen(false)
                  }}
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    f.id === currentFilmId
                      ? 'bg-card-alt text-accent'
                      : 'text-ink hover:bg-card-alt'
                  }`}
                >
                  {f.title}
                </button>
              </li>
            ))}
            {q && filtered.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-ink-soft">No films match "{q}".</li>
            )}
          </ul>
          {currentTitle && (
            <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink-soft">
              Current: <span className="font-mono">{currentTitle}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
