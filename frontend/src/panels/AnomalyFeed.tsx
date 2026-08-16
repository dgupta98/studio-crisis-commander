import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import type { DetectionRow } from '@/api/contracts'

const SEV_CRITICAL = 8
const SEV_WARN = 5

function level(severity: number): 'info' | 'warn' | 'critical' {
  if (severity >= SEV_CRITICAL) return 'critical'
  if (severity >= SEV_WARN) return 'warn'
  return 'info'
}

export function AnomalyFeed() {
  const state = useRunStore((s) => s.panelStates.anomaly)
  const rows = useRunStore((s) => s.recentDetections)

  return (
    <PanelStateWrapper state={state} label="Anomaly Feed">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">
          Anomaly Feed
        </div>
        <motion.ul variants={listStagger} initial="hidden" animate="visible" className="space-y-2">
          {rows.map((r: DetectionRow) => {
            const lvl = level(r.severity)
            return (
            <motion.li
              key={r.dedup_key}
              variants={traceRowEnter}
              className="flex items-center gap-3 border-b border-line pb-2"
            >
              <SeverityChip level={lvl}>{lvl}</SeverityChip>
              <span className="text-sm text-ink truncate max-w-[10rem]">
                {r.film_title || `Film ${r.film_id}`}
              </span>
              <span className="text-sm text-ink-soft">{r.region}</span>
              <span className="text-xs text-ink-soft flex-1 truncate">{r.metric}</span>
              <span className="text-xs font-mono text-ink-soft tabular-nums">
                {r.severity.toFixed(1)}
              </span>
            </motion.li>
            )
          })}
        </motion.ul>
      </Card>
    </PanelStateWrapper>
  )
}
