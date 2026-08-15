import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import type { SseEvent, Finding } from '@/api/contracts'

type Stage = 'Detection' | 'Investigation' | 'Decision' | 'Report' | 'Pipeline'

function stageOf(type: string): Stage | null {
  if (type.startsWith('detection.')) return 'Detection'
  if (type.startsWith('investigation.') || type.startsWith('signal.')) return 'Investigation'
  if (type.startsWith('decision.') || type.startsWith('action.') || type.startsWith('approval.')) return 'Decision'
  if (type.startsWith('report.')) return 'Report'
  if (type.startsWith('pipeline.')) return 'Pipeline'
  return null
}

function eventLabel(ev: SseEvent): string {
  const parts = ev.type.split('.')
  return parts[parts.length - 1].replace(/_/g, ' ')
}

const STAGE_ORDER: Stage[] = ['Detection', 'Investigation', 'Decision', 'Report', 'Pipeline']

export function AgentTrace() {
  const state = useRunStore((s) => s.panelStates.trace)
  const events = useRunStore((s) => s.events)

  const grouped = useMemo(() => {
    const g: Record<Stage, SseEvent[]> = {
      Detection: [], Investigation: [], Decision: [], Report: [], Pipeline: [],
    }
    for (const e of events) {
      const st = stageOf(e.type)
      if (st) g[st].push(e)
    }
    return g
  }, [events])

  return (
    <PanelStateWrapper state={state} label="Agent Trace" idleLabel="Idle · press Inject to begin">
      <Card className="p-4 min-h-[480px]">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-4">
          Live Agent Trace
        </div>
        <motion.div variants={listStagger} initial="hidden" animate="visible" className="space-y-6">
          {STAGE_ORDER
            .filter((s) => grouped[s].length > 0)
            .map((s) => (
              <motion.section key={s} variants={traceRowEnter}>
                <h3 className="font-display text-2xl tracking-tight text-ink mb-2">{s}</h3>
                <motion.ul variants={listStagger} initial="hidden" animate="visible" className="space-y-2">
                  {grouped[s].map((e) => {
                    const finding = (e.data as { finding?: Finding }).finding
                    return (
                      <motion.li key={e.seq} variants={traceRowEnter} className="border-l-2 border-line pl-3">
                        <div className="text-sm text-ink capitalize">{eventLabel(e)}</div>
                        {finding?.sql && (
                          <div className="mt-1"><SqlBlock sql={finding.sql} /></div>
                        )}
                        {finding?.narrative && (
                          <div className="mt-1 text-sm text-ink-soft italic">
                            {finding.narrative}
                          </div>
                        )}
                      </motion.li>
                    )
                  })}
                </motion.ul>
              </motion.section>
            ))}
        </motion.div>
      </Card>
    </PanelStateWrapper>
  )
}
