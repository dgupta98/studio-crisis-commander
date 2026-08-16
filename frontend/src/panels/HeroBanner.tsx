import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { heroReveal } from '@/motion/choreography'
import { regionLabel } from '@/lib/regions'

// Backend metric names are `<table>.<column>` (see backend/data/mv/refresh.py):
//   audience_sentiment.avg_score, social_trends.avg_virality,
//   box_office_revenue.revenue_usd, trailer_analytics.avg_completion_rate.
// The `virality` check must not be `social_virality` — that substring never
// appears in the wire name.
function humanCrisis(metric: string): string {
  if (metric.includes('virality')) return 'Virality Anomaly'
  if (metric.includes('sentiment')) return 'Sentiment Collapse'
  if (metric.includes('box_office')) return 'Box-office Shock'
  if (metric.includes('trailer')) return 'Trailer Anomaly'
  return 'Anomaly Detected'
}

export function HeroBanner() {
  const state = useRunStore((s) => s.panelStates.hero)
  const det = useRunStore((s) => s.detection)
  const mode = useRunStore((s) => s.mode)
  const events = useRunStore((s) => s.events)

  return (
    <PanelStateWrapper state={state} label="Hero" idleLabel="Waiting for anomaly · system nominal">
      {det && (
        <motion.div variants={heroReveal} initial="hidden" animate="visible">
          {/* Cinema letterbox: matte black bars top+bottom around the card. */}
          <div className="relative">
            <div aria-hidden className="h-3 bg-black rounded-t-md" />
            <Card className="p-8 bg-card border-l-4 border-accent rounded-none">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs uppercase tracking-wider text-ink-soft">
                  Now Investigating
                </span>
                {mode === 'fallback' && <SeverityChip level="replay">REPLAY</SeverityChip>}
              </div>
              <h1 className="font-display text-5xl tracking-tight leading-none mb-2">
                {humanCrisis(det.metric)}
              </h1>
              <div className="text-lg text-ink-soft mb-4">
                {det.film_title ? det.film_title : `Film ${det.film_id}`} · {regionLabel(det.region)}
              </div>
              <div className="flex items-baseline gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wider text-ink-soft">Severity</div>
                  <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                    {det.severity.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-ink-soft">Magnitude</div>
                  <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                    {det.magnitude.toFixed(1)}
                  </div>
                </div>
                <div className="ml-auto text-sm text-ink-soft italic">
                  {events.length > 0 && `${events.length} events`}
                </div>
              </div>
            </Card>
            <div aria-hidden className="h-3 bg-black rounded-b-md" />
          </div>
        </motion.div>
      )}
    </PanelStateWrapper>
  )
}
