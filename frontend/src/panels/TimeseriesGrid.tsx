import { useEffect, useMemo } from 'react'
import { Sparkline } from '@/components/Sparkline'
import { useRunStore } from '@/store/runStore'
import { regionLabel } from '@/lib/regions'
import { tokens } from '@/theme/tokens'
import type { MetricPoint } from '@/api/contracts'

const FAMILIES = [
  { key: 'box_office_daily',        label: 'Box office',  hex: tokens.signal.box_office.hex, fmt: (v: number) => `$${compact.format(v)}` },
  { key: 'social_virality_hourly',  label: 'Social',      hex: tokens.signal.social.hex,     fmt: (v: number) => compact.format(v) },
  { key: 'sentiment_hourly',        label: 'Sentiment',   hex: tokens.signal.reviews.hex,    fmt: (v: number) => v.toFixed(2) },
  { key: 'trailer_hourly',          label: 'Trailer',     hex: tokens.signal.streaming.hex,  fmt: (v: number) => compact.format(v) },
] as const

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function toPoints(rows: any[], valueKey: string): MetricPoint[] {
  return rows.map((r) => ({ ts: r.ts, value: Number(r[valueKey]) || 0 }))
}

// Latest value plus % delta vs the first point. Returns null-safe strings the
// caller can render straight into the DOM.
function latestDelta(points: MetricPoint[]): { latest: number; delta: number } | null {
  if (points.length === 0) return null
  const first = points[0].value
  const last  = points[points.length - 1].value
  const delta = first === 0 ? (last === 0 ? 0 : 100) : ((last - first) / Math.abs(first)) * 100
  return { latest: last, delta }
}

function deltaColor(delta: number): string {
  if (delta >= 5)  return '#74db8d'
  if (delta <= -5) return '#ff6b7a'
  return tokens.color.inkSoft
}

export function TimeseriesGrid() {
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const metrics = useRunStore((s) => s.metrics)
  const loadMetrics = useRunStore((s) => s.loadMetrics)

  useEffect(() => {
    if (selectedFilmId !== null && selectedRegion) {
      void loadMetrics(selectedFilmId, selectedRegion, 168)
    }
  }, [selectedFilmId, selectedRegion, loadMetrics])

  const key = selectedFilmId !== null && selectedRegion
    ? `${selectedFilmId}:${selectedRegion}`
    : null
  const res = key ? metrics[key] : undefined
  const sentimentScope = res?.sentiment_scope ?? 'region'

  const series = useMemo(() => {
    if (!res) return null
    return {
      box_office_daily:       toPoints(res.timeseries.box_office_daily, 'revenue_usd'),
      social_virality_hourly: toPoints(res.timeseries.social_virality_hourly, 'volume'),
      sentiment_hourly:       toPoints(res.timeseries.sentiment_hourly, 'avg_score'),
      trailer_hourly:         toPoints(res.timeseries.trailer_hourly, 'views'),
    }
  }, [res])

  if (selectedFilmId === null) return null
  if (!selectedRegion) {
    return (
      <section className="rounded-md border border-line bg-card p-4 text-center text-xs text-ink-soft">
        Pick a region on the heat bar to load timeseries.
      </section>
    )
  }

  return (
    <section className="rounded-md border border-line bg-card p-4" data-testid="timeseries-grid">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
          Timeseries · {regionLabel(selectedRegion)}
        </span>
        {res && (
          <span className="font-mono text-[10px] text-ink-soft">
            {res.query_latency_ms}ms · last 168h
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FAMILIES.map(({ key, label, hex, fmt }) => {
          const points = series ? series[key] : []
          const stat = latestDelta(points)
          const isSentimentFallback = key === 'sentiment_hourly' && sentimentScope === 'film'
          const displayLabel = isSentimentFallback ? `${label} · all regions` : label
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <span
                  className="text-[10px] uppercase tracking-wider text-ink-soft"
                  title={isSentimentFallback ? 'Regional review data is sparse — showing film-wide sentiment.' : undefined}
                >
                  {displayLabel}
                </span>
                {stat && (
                  <span className="font-mono text-[10px] tabular-nums" style={{ color: deltaColor(stat.delta) }}>
                    {stat.delta >= 0 ? '+' : ''}{stat.delta.toFixed(0)}%
                  </span>
                )}
              </div>
              {stat && (
                <span className="font-mono text-xs text-ink tabular-nums">
                  {fmt(stat.latest)}
                </span>
              )}
              <Sparkline label="" color={hex} data={points} heightPx={40} />
            </div>
          )
        })}
      </div>
    </section>
  )
}
