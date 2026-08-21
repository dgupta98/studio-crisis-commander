import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
}

const CRISIS_TYPES = ['box_office_drop', 'social_meltdown', 'review_bomb', 'streaming_spike'] as const
const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'KR', 'CN', 'IN', 'BR', 'MX', 'AU', 'CA', 'IT', 'ES', 'RU']

export function GlobalInjectModal({ open, onClose }: Props) {
  const [ctype, setCtype] = useState<typeof CRISIS_TYPES[number]>('box_office_drop')
  const [filmId, setFilmId] = useState('1')
  const [region, setRegion] = useState('US')
  const [magnitude, setMagnitude] = useState('0.4')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/inject-crisis`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ctype,
          film_id: Number(filmId),
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
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ink-soft">Film ID</span>
            <input
              aria-label="Film ID"
              value={filmId}
              onChange={(e) => setFilmId(e.target.value)}
              className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm font-mono"
            />
          </label>
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
        </div>
        <label className="mt-3 block">
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
