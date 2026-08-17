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
  const recent = useRunStore((s) => s.recentDetections)

  // Cold-load fallback: without an active run, hydrate from the most recent
  // completed detection so the top of the page shows a real headline instead
  // of an "idle" placeholder (which paired oddly with a populated feed).
  const historical = !det && recent.length > 0 ? recent[0] : null
  const displayDet = det ?? historical
  const isHistorical = det === null && historical !== null

  if (displayDet) {
    return (
      <motion.div variants={heroReveal} initial="hidden" animate="visible">
        <div className="relative">
          <div aria-hidden className="h-3 bg-black rounded-t-md" />
          <Card className="p-8 bg-card border-l-4 border-accent rounded-none">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs uppercase tracking-wider text-ink-soft">
                {isHistorical ? 'Last Investigation' : 'Now Investigating'}
              </span>
              {mode === 'fallback' && <SeverityChip level="replay">REPLAY</SeverityChip>}
              {isHistorical && (
                <span className="text-xs uppercase tracking-wider text-ink-soft italic">
                  · press Inject to start a new one
                </span>
              )}
            </div>
            <h1 className="font-display text-5xl tracking-tight leading-none mb-2">
              {humanCrisis(displayDet.metric)}
            </h1>
            <div className="text-lg text-ink-soft mb-4">
              {displayDet.film_title ? displayDet.film_title : `Film ${displayDet.film_id}`} · {regionLabel(displayDet.region)}
            </div>
            <div className="flex items-baseline gap-6">
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-soft">Severity</div>
                <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                  {displayDet.severity.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-soft">Magnitude</div>
                <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                  {displayDet.magnitude.toFixed(1)}
                </div>
              </div>
              <div className="ml-auto text-sm text-ink-soft italic">
                {!isHistorical && events.length > 0 && `${events.length} events`}
              </div>
            </div>
          </Card>
          <div aria-hidden className="h-3 bg-black rounded-b-md" />
        </div>
      </motion.div>
    )
  }

  return (
    <PanelStateWrapper state={state} label="Hero" idleLabel="Waiting for anomaly · system nominal">
      <div />
    </PanelStateWrapper>
  )
}
