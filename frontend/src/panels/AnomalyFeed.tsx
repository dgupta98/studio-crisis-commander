import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SeverityChip } from '@/components/SeverityChip'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import { regionLabel } from '@/lib/regions'
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
  const current = useRunStore((s) => s.detection)

  // Fall back to the live in-flight detection so the panel isn't blank
  // between inject and the first `/detections` refresh.
  const display: DetectionRow[] =
    rows.length > 0 ? rows : current ? [current] : []

  return (
    <PanelStateWrapper state={state} label="Anomaly Feed">
      <Card data-testid="anomaly-feed" className="p-5">
        <div className="text-sm uppercase tracking-wider text-ink-soft mb-4">
          Anomaly Feed
        </div>
        <motion.ul variants={listStagger} initial="hidden" animate="visible" className="space-y-3">
          {display.slice(0, 8).map((r: DetectionRow) => {
            const lvl = level(r.severity)
            return (
            <motion.li
              key={r.dedup_key}
              variants={traceRowEnter}
              className="flex flex-col gap-1 border-b border-line pb-3"
            >
              <div className="flex items-center gap-2">
                <SeverityChip level={lvl}>{lvl}</SeverityChip>
                <span className="text-base text-ink truncate flex-1">
                  {r.film_title || `Film ${r.film_id}`}
                </span>
                <span className="text-sm font-mono text-ink-soft tabular-nums">
                  {r.severity.toFixed(1)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <span className="truncate">{regionLabel(r.region)}</span>
                <span className="opacity-50">·</span>
                <span className="truncate flex-1">{r.metric}</span>
              </div>
            </motion.li>
            )
          })}
        </motion.ul>
        {display.length > 8 && (
          <div className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
            +{display.length - 8} more · <a href="/audit" className="underline hover:text-ink">view audit</a>
          </div>
        )}
      </Card>
    </PanelStateWrapper>
  )
}
