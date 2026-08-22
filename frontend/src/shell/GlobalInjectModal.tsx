import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-selected film when opened from a Movie Detail page. */
  defaultFilm?: { id: number; title: string } | null
}

const CRISIS_TYPES = ['box_office_drop', 'social_meltdown', 'review_bomb', 'streaming_spike'] as const
const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'KR', 'CN', 'IN', 'BR', 'MX', 'AU', 'CA', 'IT', 'ES', 'RU']
const MAX_LIST = 40

type Shelf = { id: string; title: string; films: { id: number; title: string }[] }
type Film = { id: number; title: string }

function flattenFilms(shelves: Shelf[] | undefined): Film[] {
  if (!shelves) return []
  const byId = new Map<number, string>()
  for (const shelf of shelves) {
    for (const f of shelf.films ?? []) {
      if (!byId.has(f.id) && f.title) byId.set(f.id, f.title)
    }
  }
  return Array.from(byId, ([id, title]) => ({ id, title })).sort((a, b) =>
    a.title.localeCompare(b.title),
  )
}

export function GlobalInjectModal({ open, onClose, defaultFilm = null }: Props) {
  const [ctype, setCtype] = useState<typeof CRISIS_TYPES[number]>('box_office_drop')
  const [region, setRegion] = useState('US')
  const [magnitude, setMagnitude] = useState('0.4')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [queryText, setQueryText] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: shelvesRaw } = useQuery({
    ...queries.shelves(null),
    enabled: open,
  })
  const films = useMemo(() => flattenFilms(shelvesRaw as Shelf[] | undefined), [shelvesRaw])

  // Reset every time the modal opens so a stale prior selection can't leak
  // into the next invocation. Depend on `defaultFilm?.id`, not the object,
  // so parent re-renders with a fresh object literal don't stomp typing.
  useEffect(() => {
    if (!open) return
    setErr(null)
    setBusy(false)
    setDropdownOpen(false)
    if (defaultFilm) {
      setQueryText(defaultFilm.title)
      setSelectedId(defaultFilm.id)
    } else {
      setQueryText('')
      setSelectedId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFilm?.id])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!dropdownOpen) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [dropdownOpen])

  const filteredFilms = useMemo(() => {
    const q = queryText.trim().toLowerCase()
    if (!q) return films.slice(0, MAX_LIST)
    return films.filter((f) => f.title.toLowerCase().includes(q)).slice(0, MAX_LIST)
  }, [films, queryText])

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const trimmed = queryText.trim()
    let filmId = selectedId
    if (filmId === null) {
      const exact = films.find((f) => f.title.toLowerCase() === trimmed.toLowerCase())
      if (exact) filmId = exact.id
      else if (/^\d+$/.test(trimmed)) filmId = Number(trimmed)
    }
    if (filmId === null) {
      setErr('Pick a movie from the list.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/inject-crisis`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ctype,
          film_id: filmId,
          region,
          magnitude: Number(magnitude),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      window.location.href = `/dashboard?run_id=${encodeURIComponent(body.run_id)}`
    } catch (e: any) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-line bg-card p-6 shadow-2xl"
      >
        <h2 className="mb-4 font-display text-lg">Inject Crisis</h2>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Crisis type</span>
          <select
            aria-label="Crisis type"
            value={ctype}
            onChange={(e) => setCtype(e.target.value as any)}
            className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm"
          >
            {CRISIS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <div className="mt-3">
          <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Movie</span>
          <div ref={containerRef} className="relative">
            <input
              aria-label="Movie"
              autoComplete="off"
              value={queryText}
              placeholder={films.length === 0 ? 'Loading catalog…' : 'Type to search titles…'}
              disabled={films.length === 0}
              onChange={(e) => {
                setQueryText(e.target.value)
                setSelectedId(null)
                setDropdownOpen(true)
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setDropdownOpen(false)
                }
              }}
              className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            {dropdownOpen && filteredFilms.length > 0 && (
              <ul
                role="listbox"
                className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded border border-line bg-card shadow-lg"
              >
                {filteredFilms.map((f) => (
                  <li
                    key={f.id}
                    role="option"
                    aria-selected={selectedId === f.id}
                    onMouseDown={(e) => {
                      // preventDefault keeps the input focused so the click
                      // registers before the input's blur fires.
                      e.preventDefault()
                      setQueryText(f.title)
                      setSelectedId(f.id)
                      setDropdownOpen(false)
                    }}
                    className={`cursor-pointer px-3 py-2 text-sm ${
                      selectedId === f.id
                        ? 'bg-card-alt text-accent'
                        : 'text-ink hover:bg-card-alt'
                    }`}
                  >
                    {f.title}
                  </li>
                ))}
              </ul>
            )}
            {dropdownOpen && films.length > 0 && filteredFilms.length === 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-line bg-card px-3 py-2 text-xs text-ink-soft shadow-lg">
                No films match “{queryText}”.
              </div>
            )}
          </div>
          {selectedId !== null && (
            <span className="mt-1 block text-[11px] text-ink-soft">
              Selected film id: <span className="font-mono">{selectedId}</span>
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Region</span>
            <select
              aria-label="Region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm"
            >
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Magnitude</span>
            <input
              aria-label="Magnitude"
              type="number"
              step="0.05"
              min="0.05"
              max="1"
              value={magnitude}
              onChange={(e) => setMagnitude(e.target.value)}
              className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm font-mono"
            />
          </label>
        </div>
        {err && <p className="mt-3 text-xs text-rose-400">{err}</p>}
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-ink-soft hover:text-ink">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-accent bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/30 disabled:opacity-50"
          >
            {busy ? 'Injecting…' : 'Inject'}
          </button>
        </div>
      </form>
    </div>
  )
}
