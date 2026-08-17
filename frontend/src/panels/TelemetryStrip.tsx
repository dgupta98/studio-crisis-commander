import { useEffect } from 'react'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Sparkline } from '@/components/Sparkline'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import type { MetricPoint } from '@/api/contracts'

type Series = { label: string; data: MetricPoint[] }

// The `/metrics/{film_id}/{region}` endpoint returns 4 rollup families;
// which one fired maps by metric prefix. When none match (e.g. refund_surge
// hits `ticket_refunds` — not in the rollup set), the panel shows a
// fired-signal callout so the user isn't staring at four empty sparklines.
function firedFamily(metric: string): keyof Timeseries | null {
  if (metric.includes('box_office')) return 'box_office_daily'
  if (metric.includes('virality') || metric.includes('social')) return 'social_virality_hourly'
  if (metric.includes('sentiment')) return 'sentiment_hourly'
  if (metric.includes('trailer')) return 'trailer_hourly'
  return null
}

type Timeseries = {
  box_office_daily: MetricPoint[]
  social_virality_hourly: MetricPoint[]
  sentiment_hourly: MetricPoint[]
  trailer_hourly: MetricPoint[]
}

export function TelemetryStrip() {
  const state = useRunStore((s) => s.panelStates.telemetry)
  const metrics = useRunStore((s) => s.metrics)
  const latency = useRunStore((s) => s.latencyMs)
  const detection = useRunStore((s) => s.detection)
  const recent = useRunStore((s) => s.recentDetections)
  const loadMetrics = useRunStore((s) => s.loadMetrics)

  // Cold-load fallback: without an active detection, use the most recent
  // completed one so the panel isn't blank while Anomaly Feed shows history.
  const effective = detection ?? (recent.length > 0 ? recent[0] : null)

  useEffect(() => {
    if (!effective) return
    const key = `${effective.film_id}:${effective.region}`
    if (metrics[key]) return
    void loadMetrics(effective.film_id, effective.region)
  }, [effective, metrics, loadMetrics])

  const key = effective ? `${effective.film_id}:${effective.region}` : null
  const first = key ? metrics[key] : Object.values(metrics)[0]

  const series: Series[] = first
    ? [
        { label: 'Box Office', data: first.timeseries.box_office_daily },
        { label: 'Virality',   data: first.timeseries.social_virality_hourly },
        { label: 'Sentiment',  data: first.timeseries.sentiment_hourly },
        { label: 'Trailer',    data: first.timeseries.trailer_hourly },
      ]
    : []
  const allEmpty = series.length > 0 && series.every((s) => s.data.length === 0)
  const fired = effective ? firedFamily(effective.metric) : null
  const isHistorical = detection === null && effective !== null

  // Bypass idle wrapper when we have a historical detection to render from —
  // otherwise the panel showed "Idle — awaiting metrics" on cold load while
  // Anomaly Feed was fully populated.
  const body = (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-ink-soft">
          Telemetry{isHistorical && ' · last run'}
        </span>
        {latency !== null && (
          <span className="font-mono text-xs text-ink-soft">
            ClickHouse · {latency} ms
          </span>
        )}
      </div>
      {first && !allEmpty && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {series.map((s) => (
            <Sparkline key={s.label} data={s.data} label={s.label} />
          ))}
        </div>
      )}
      {first && allEmpty && effective && (
        <div className="rounded border border-line p-3">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-1">
            Fired signal
          </div>
          <div className="font-mono text-sm text-ink">{effective.metric}</div>
          <div className="mt-2 flex items-baseline gap-4 text-sm">
            <div>
              <span className="text-ink-soft">actual · </span>
              <span className="font-mono tabular-nums">
                {effective.actual_value.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-ink-soft">baseline · </span>
              <span className="font-mono tabular-nums">
                {effective.baseline_value.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-ink-soft">magnitude · </span>
              <span className="font-mono tabular-nums">
                {effective.magnitude.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs text-ink-soft italic">
            No rollup timeseries for this film/region — the fired metric lives outside
            the four charted families{fired ? '' : ' (e.g. refunds, streaming, spend)'}.
          </div>
        </div>
      )}
    </Card>
  )

  if (effective) return body

  return (
    <PanelStateWrapper state={state} label="Telemetry" idleLabel="Idle — awaiting metrics">
      {body}
    </PanelStateWrapper>
  )
}
