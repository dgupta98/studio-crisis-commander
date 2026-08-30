import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRegionMetrics } from '@/api/regionMetrics'
import { regionLabel } from '@/lib/regions'
import { tokens } from '@/theme/tokens'
import { useRunStore } from '@/store/runStore'
import type { RegionSummary } from '@/api/contracts'

const fmtCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function arrow(delta: number): { char: string; color: string } {
  if (delta >= 5) return { char: '▲', color: '#74db8d' }
  if (delta <= -5) return { char: '▼', color: '#ff6b7a' }
  return { char: '•', color: tokens.color.inkSoft }
}

export function RegionalLeaderboard() {
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const pickRegion     = useRunStore((s) => s.pickRegion)

  const { data } = useQuery({
    queryKey: ['region-metrics', selectedFilmId],
    queryFn: () => fetchRegionMetrics(selectedFilmId as number, 168),
    staleTime: 60_000,
    enabled: selectedFilmId !== null,
  })

  const rows = useMemo(() => {
    const list = (data?.regions ?? []) as RegionSummary[]
    return [...list]
      .filter((r) => r.signals.box_office.volume > 0)
      .sort((a, b) => b.signals.box_office.volume - a.signals.box_office.volume)
      .slice(0, 5)
  }, [data])

  const maxVolume = rows.reduce((m, r) => Math.max(m, r.signals.box_office.volume), 1)

  return (
    <section
      className="flex flex-col rounded-md border border-line bg-card p-3"
      data-testid="regional-leaderboard"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
          Top regions · revenue 7d
        </span>
        {data && (
          <span className="font-mono text-[10px] text-ink-soft">
            {data.query_latency_ms}ms
          </span>
        )}
      </div>
      {selectedFilmId === null ? (
        <div className="flex flex-1 items-center justify-center text-center text-xs text-ink-soft">
          Pick a movie to compare regions.
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-xs text-ink-soft">
          No regional revenue yet.
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-1.5">
          {rows.map((r, i) => {
            const isSelected = selectedRegion === r.code
            const volume = r.signals.box_office.volume
            const barPct = Math.max(4, Math.round((volume / maxVolume) * 100))
            const delta = r.signals.box_office.delta_pct
            const a = arrow(delta)
            const sign = delta >= 0 ? '+' : ''
            return (
              <li key={r.code}>
                <button
                  type="button"
                  onClick={() => pickRegion(isSelected ? null : r.code)}
                  aria-pressed={isSelected}
                  className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left transition-colors ${
                    isSelected
                      ? 'border-accent bg-card-alt'
                      : 'border-line bg-card hover:bg-card-alt'
                  }`}
                >
                  <span className="w-3 font-mono text-[10px] text-ink-soft">{i + 1}</span>
                  <span className="w-20 truncate text-[11px] text-ink">{regionLabel(r.code)}</span>
                  <div className="relative flex-1">
                    <div
                      className="h-1.5 rounded-sm"
                      style={{
                        width: `${barPct}%`,
                        background: tokens.signal.box_office.hex,
                        opacity: isSelected ? 1 : 0.7,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-[10px] text-ink">
                    ${fmtCompact.format(volume)}
                  </span>
                  <span
                    className="w-12 text-right font-mono text-[10px]"
                    style={{ color: a.color }}
                  >
                    {a.char}{sign}{delta}%
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
