import { useState } from 'react'
import { useRunStore, type PastRunDetail } from '@/store/runStore'
import { queryClient } from '@/api/queryClient'
import { queries } from '@/api/queries'

interface Run {
  run_id: string
  at: string
  ctype: string
  magnitude: number
  severity: string
}

export function RunTimeline({ filmId, runs }: { filmId: number; runs: Run[] }) {
  const selectPastRun = useRunStore((s) => s.selectPastRun)
  const activeRunId   = useRunStore((s) => s.runId)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  if (!runs.length) {
    return <div className="rounded-md border border-line bg-card p-4 text-xs text-ink-soft">No past runs.</div>
  }

  const onClick = async (rid: string) => {
    if (loadingId) return
    setLoadingId(rid)
    try {
      const data = await queryClient.fetchQuery(
        queries.filmRunDetail(filmId, rid),
      )
      selectPastRun(data as PastRunDetail)
    } catch (e) {
      console.error('[RunTimeline] failed to load run', rid, e)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm font-semibold tracking-tight text-ink">Past runs</h3>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
        {runs.map((r) => {
          const selected = activeRunId === r.run_id
          const loading  = loadingId === r.run_id
          return (
            <li key={r.run_id}>
              <button
                type="button"
                onClick={() => onClick(r.run_id)}
                aria-current={selected ? 'true' : undefined}
                aria-busy={loading ? 'true' : undefined}
                disabled={loading}
                className={`grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-3 py-2 text-left text-xs transition-colors ${
                  selected
                    ? 'bg-card-alt text-ink'
                    : 'text-ink hover:bg-card-alt/60'
                } ${loading ? 'opacity-60' : ''}`}
              >
                <span className="font-mono text-ink-soft">{new Date(r.at).toLocaleString()}</span>
                <span className="truncate">{r.ctype}</span>
                <span className="font-mono">Δ {r.magnitude.toFixed(2)}</span>
                <span className="font-mono uppercase text-ink-soft">{r.severity}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
