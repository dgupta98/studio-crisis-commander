import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'

interface Props {
  open: boolean
  onClose: () => void
}

const CRISIS_TYPES = ['box_office_drop', 'social_meltdown', 'review_bomb', 'streaming_spike'] as const
const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'KR', 'CN', 'IN', 'BR', 'MX', 'AU', 'CA', 'IT', 'ES', 'RU']

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

export function GlobalInjectModal({ open, onClose }: Props) {
  const [ctype, setCtype] = useState<typeof CRISIS_TYPES[number]>('box_office_drop')
  const [filmQuery, setFilmQuery] = useState('')
  const [region, setRegion] = useState('US')
  const [magnitude, setMagnitude] = useState('0.4')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const listId = useId()

  // Cached from Dashboard/Movies prefetch — no extra network hit on modal open.
  const { data: shelvesRaw } = useQuery({
    ...queries.shelves(null),
    enabled: open,
  })
  const films = useMemo(() => flattenFilms(shelvesRaw as Shelf[] | undefined), [shelvesRaw])
  const filmByTitle = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of films) m.set(f.title.toLowerCase(), f.id)
    return m
  }, [films])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open && !filmQuery && films.length > 0) setFilmQuery(films[0].title)
  }, [open, films, filmQuery])

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const trimmed = filmQuery.trim()
    let filmId: number | null = filmByTitle.get(trimmed.toLowerCase()) ?? null
    if (filmId === null && /^\d+$/.test(trimmed)) filmId = Number(trimmed)
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
        <label className="mt-3 block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Movie</span>
          <input
            aria-label="Movie"
            list={listId}
            value={filmQuery}
            onChange={(e) => setFilmQuery(e.target.value)}
            placeholder="Start typing a title…"
            autoComplete="off"
            className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm"
          />
          <datalist id={listId}>
            {films.map((f) => (
              <option key={f.id} value={f.title} />
            ))}
          </datalist>
          {films.length === 0 && (
            <span className="mt-1 block text-[11px] text-ink-soft">Loading catalog…</span>
          )}
        </label>
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
