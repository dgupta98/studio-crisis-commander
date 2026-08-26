import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'
import { useRunStore } from '@/store/runStore'
import type { CrisisType } from '@/api/contracts'
import { MultiRegionPicker } from '@/components/MultiRegionPicker'

// Minimal themed select. The native <select>'s popup is rendered by the OS
// (light Aqua panel on macOS) and cannot be styled to match the dark modal
// — every option in the list would appear on a pale gray background. This
// component keeps the same shape as the input to its right (Region) so
// heights stay aligned in the 2-col grid.
interface ThemedSelectProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  ariaLabel: string
  buttonClass?: string
}
function ThemedSelect<T extends string>({
  value, onChange, options, ariaLabel, buttonClass = '',
}: ThemedSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
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
  const current = options.find((o) => o.value === value)
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded border border-line bg-paper px-2 py-1.5 text-left text-sm outline-none focus:border-accent flex items-center justify-between gap-2 ${buttonClass}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <span className="text-ink-soft text-[10px] shrink-0">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded border border-line bg-card shadow-lg"
        >
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(o.value)
                setOpen(false)
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${
                o.value === value
                  ? 'bg-card-alt text-accent'
                  : 'text-ink hover:bg-card-alt'
              }`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-selected film when opened from a Movie Detail page. */
  defaultFilm?: { id: number; title: string } | null
}

// Wire values MUST match backend `data.ground_truth.CrisisType` — pipeline
// throws KeyError on unknown values and silently falls into demo mode.
const CRISIS_TYPES: { value: CrisisType; label: string }[] = [
  { value: 'regional_sentiment_collapse',    label: 'Regional sentiment collapse' },
  { value: 'trailer_variant_underperformance', label: 'Trailer variant underperformance' },
  { value: 'competitor_release_impact',      label: 'Competitor release impact' },
  { value: 'marketing_overspend_low_roi',    label: 'Marketing overspend, low ROI' },
  { value: 'streaming_completion_drop',      label: 'Streaming completion drop' },
  { value: 'refund_spike',                   label: 'Refund spike' },
  { value: 'negative_social_virality',       label: 'Negative social virality' },
  { value: 'review_score_divergence',        label: 'Review score divergence' },
]
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
  const navigate = useNavigate()
  const injectAction = useRunStore((s) => s.inject)
  const [ctype, setCtype] = useState<CrisisType>('regional_sentiment_collapse')
  // Multi-region: default to a single-region selection (NA) so single-region
  // demos still work with one click. User can add more via the picker.
  const [regions, setRegions] = useState<string[]>(['NA'])
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
    if (regions.length === 0) {
      setErr('Pick at least one region.')
      return
    }
    setBusy(true)
    try {
      if (regions.length > 1) {
        await injectAction({
          crisisType: ctype,
          filmId,
          regions,
          magnitude: Number(magnitude),
        })
      } else {
        await injectAction({
          crisisType: ctype,
          filmId,
          region: regions[0],
          magnitude: Number(magnitude),
        })
      }
      onClose()
      // Land on the dashboard scoped to the injected movie so the analyst
      // sees the heat bar + investigation with the fresh run pulsing on
      // any injected regions.
      navigate(`/dashboard?film=${filmId}${regions.length === 1 ? `&region=${encodeURIComponent(regions[0])}` : ''}`)
    } catch (e: any) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-card p-5 shadow-2xl sm:p-6"
      >
        <h2 className="mb-4 font-display text-lg font-bold tracking-tight text-ink">Inject Crisis</h2>
        <div className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Crisis type</span>
          <ThemedSelect<CrisisType>
            ariaLabel="Crisis type"
            value={ctype}
            onChange={setCtype}
            options={CRISIS_TYPES}
          />
        </div>

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

        <div className="mt-3 flex flex-col gap-3">
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">
              Regions
            </span>
            <MultiRegionPicker value={regions} onChange={setRegions} />
          </div>
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
              className="w-40 rounded border border-line bg-paper px-2 py-1.5 text-sm font-mono"
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
