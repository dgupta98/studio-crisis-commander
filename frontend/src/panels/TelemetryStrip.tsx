import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { Sparkline } from '@/components/Sparkline'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'

export function TelemetryStrip() {
  const state = useRunStore((s) => s.panelStates.telemetry)
  const metrics = useRunStore((s) => s.metrics)
  const latency = useRunStore((s) => s.latencyMs)

  const first = Object.values(metrics)[0]

  return (
    <PanelStateWrapper state={state} label="Telemetry" idleLabel="Idle — awaiting metrics">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-ink-soft">Telemetry</span>
          {latency !== null && (
            <span className="font-mono text-xs text-ink-soft">
              ClickHouse · {latency} ms
            </span>
          )}
        </div>
        {first && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Sparkline data={first.timeseries.box_office_daily} label="Box Office" />
            <Sparkline data={first.timeseries.social_virality_hourly} label="Virality" />
            <Sparkline data={first.timeseries.sentiment_hourly} label="Sentiment" />
            <Sparkline data={first.timeseries.trailer_hourly} label="Trailer" />
          </div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
