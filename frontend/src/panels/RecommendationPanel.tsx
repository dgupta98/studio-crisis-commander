import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { Popover } from '@/components/Popover'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { panelReveal, listStagger, traceRowEnter } from '@/motion/choreography'
import type { KeyFigure, RecommendedAction } from '@/api/contracts'

export function RecommendationPanel() {
  const state = useRunStore((s) => s.panelStates.recommendation)
  const decision = useRunStore((s) => s.decision)
  const report = useRunStore((s) => s.report)
  const [openKf, setOpenKf] = useState<number | null>(null)

  return (
    <PanelStateWrapper state={state} label="Recommendation" idleLabel="Awaiting decision…">
      <motion.div variants={panelReveal} initial="hidden" animate="visible">
        <Card className="p-6">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-3">
            Recommendation
          </div>

          {report && (
            <>
              <h2 className="font-display text-2xl tracking-tight text-ink mb-2">
                {report.headline}
              </h2>
              <p className="text-sm text-ink-soft mb-4">{report.tldr}</p>
            </>
          )}

          {report?.key_figures && report.key_figures.length > 0 && (
            <div className="mb-6">
              <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">
                Key Figures
              </div>
              <div className="grid grid-cols-2 gap-3">
                {report.key_figures.map((kf: KeyFigure, i: number) => (
                  <Popover
                    key={i}
                    open={openKf === i}
                    trigger={
                      <button
                        type="button"
                        onClick={() => setOpenKf(openKf === i ? null : i)}
                        className="block text-left border border-line rounded p-2 hover:bg-card-alt w-full"
                      >
                        <div className="text-xs text-ink-soft mb-1">{kf.label}</div>
                        <div className="font-body text-2xl font-semibold tabular-nums text-ink tracking-tight">
                          {kf.value}
                        </div>
                      </button>
                    }
                  >
                    <div className="text-xs text-ink-soft mb-2 uppercase tracking-wider">
                      Source · {kf.source.signal} [{kf.source.query_index}]
                    </div>
                    <SqlBlock sql={kf.source_query} />
                  </Popover>
                ))}
              </div>
            </div>
          )}

          {decision?.actions && (
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">
                Recommended Actions
              </div>
              <motion.ul variants={listStagger} initial="hidden" animate="visible" className="space-y-2">
                {decision.actions.map((a: RecommendedAction, i: number) => (
                  <motion.li key={i} variants={traceRowEnter}
                             className="border-l-4 border-accent pl-3">
                    <div className="text-sm font-mono text-ink">{a.action_type}</div>
                    <div className="text-sm text-ink-soft">{a.rationale}</div>
                    {a.impact_usd !== null && (
                      <div className="text-xs text-ink-soft mt-1">
                        Impact: <span className="tabular-nums">${a.impact_usd.toLocaleString()}</span>
                      </div>
                    )}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          )}
        </Card>
      </motion.div>
    </PanelStateWrapper>
  )
}
