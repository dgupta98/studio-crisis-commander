import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { heroReveal } from '@/motion/choreography'

function humanCrisis(metric: string): string {
  if (metric.includes('sentiment')) return 'Sentiment Collapse'
  if (metric.includes('social_virality')) return 'Virality Anomaly'
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
      <motion.div variants={heroReveal} initial="hidden" animate="visible">
        <Card className="p-8 bg-card border-l-4 border-accent">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs uppercase tracking-wider text-ink-soft">
              Now Investigating
            </span>
            {mode === 'fallback' && <SeverityChip level="replay">REPLAY</SeverityChip>}
          </div>
          <h1 className="font-display text-5xl tracking-tight leading-none mb-2">
            {det ? humanCrisis(det.metric) : 'Anomaly'}
          </h1>
          <div className="text-lg text-ink-soft mb-4">
            {det && <>Film {det.film_id} · {det.region}</>}
          </div>
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-soft">Severity</div>
              <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                {det?.severity.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-soft">Magnitude</div>
              <div className="font-body text-4xl font-semibold tabular-nums tracking-tight">
                {det?.magnitude.toFixed(1)}
              </div>
            </div>
            <div className="ml-auto text-sm text-ink-soft italic">
              {events.length > 0 && `${events.length} events`}
            </div>
          </div>
        </Card>
      </motion.div>
    </PanelStateWrapper>
  )
}
