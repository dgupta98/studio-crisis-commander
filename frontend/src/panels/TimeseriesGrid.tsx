import { useEffect, useMemo } from 'react'
import { Sparkline } from '@/components/Sparkline'
import { useRunStore } from '@/store/runStore'
import { regionLabel } from '@/lib/regions'
import { tokens } from '@/theme/tokens'
import type { MetricPoint } from '@/api/contracts'

const FAMILIES = [
  { key: 'box_office_daily',        label: 'Box office',  hex: tokens.signal.box_office.hex },
  { key: 'social_virality_hourly',  label: 'Social',      hex: tokens.signal.social.hex },
  { key: 'sentiment_hourly',        label: 'Sentiment',   hex: tokens.signal.reviews.hex },
  { key: 'trailer_hourly',          label: 'Trailer',     hex: tokens.signal.streaming.hex },
] as const

// Reshape raw ClickHouse rows into MetricPoint (ts + value). The value field
// differs per family — this collapses them all so Sparkline sees a uniform
// shape.
function toPoints(rows: any[], valueKey: string): MetricPoint[] {
  return rows.map((r) => ({ ts: r.ts, value: Number(r[valueKey]) || 0 }))
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
        {FAMILIES.map(({ key, label, hex }) => (
          <Sparkline
            key={key}
            label={label}
            color={hex}
            data={series ? series[key] : []}
            heightPx={56}
          />
        ))}
      </div>
    </section>
  )
}
