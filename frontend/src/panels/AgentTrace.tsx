import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import type { SseEvent, Finding, Hypothesis } from '@/api/contracts'

type Stage = 'Detection' | 'Investigation' | 'Decision' | 'Report' | 'Pipeline'

function stageOf(type: string): Stage | null {
  if (type.startsWith('detection.')) return 'Detection'
  if (
    type.startsWith('investigation.') ||
    type.startsWith('signal.') ||
    type.startsWith('hypothesis.')
  ) return 'Investigation'
  if (type.startsWith('decision.') || type.startsWith('action.') || type.startsWith('approval.')) return 'Decision'
  if (type.startsWith('report.')) return 'Report'
  if (type.startsWith('pipeline.')) return 'Pipeline'
  return null
}

function eventLabel(ev: SseEvent): string {
  if (ev.type === 'signal.completed') {
    const sig = (ev.data as { finding?: { signal?: string } }).finding?.signal
    return sig ? `signal: ${sig.replace(/_/g, ' ')}` : 'signal completed'
  }
  if (ev.type === 'action.proposed') {
    const at = (ev.data as { action_type?: string }).action_type
    return at ? `action proposed: ${at.replace(/_/g, ' ')}` : 'action proposed'
  }
  if (ev.type === 'action.impact_computed') {
    const d = ev.data as {
      action_type?: string
      impact_usd?: number | null
      impact_error?: string | null
    }
    if (d.impact_error) return `impact failed: ${d.action_type ?? ''}`
    const usd =
      typeof d.impact_usd === 'number'
        ? `$${Math.round(d.impact_usd).toLocaleString()}`
        : '—'
    return `impact ${usd}: ${d.action_type ?? ''}`
  }
  const parts = ev.type.split('.')
  return parts[parts.length - 1].replace(/_/g, ' ')
}

const STAGE_ORDER: Stage[] = ['Detection', 'Investigation', 'Decision', 'Report', 'Pipeline']

function TraceDetail({ ev }: { ev: SseEvent }) {
  if (ev.type === 'signal.completed') {
    const finding = (ev.data as { finding?: Finding }).finding
    if (!finding) return null
    return (
      <>
        {finding.sql && (
          <div className="mt-1"><SqlBlock sql={finding.sql} /></div>
        )}
        {finding.narrative && (
          <div className="mt-1 text-sm text-ink-soft italic">
            {finding.narrative}
          </div>
        )}
      </>
    )
  }

  if (ev.type === 'hypothesis.formed') {
    const hyp = (ev.data as { hypothesis?: Hypothesis }).hypothesis
    if (!hyp) return null
    return (
      <div className="mt-1 space-y-1">
        <div className="text-sm text-ink">
          <span className="text-ink-soft">Primary cause · </span>
          {hyp.primary_cause}
        </div>
        {hyp.contributing_factors.length > 0 && (
          <ul className="text-xs text-ink-soft list-disc pl-4 space-y-0.5">
            {hyp.contributing_factors.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        )}
        <div className="text-xs text-ink-soft uppercase tracking-wider">
          Confidence: {hyp.confidence}
        </div>
      </div>
    )
  }

  if (ev.type === 'action.proposed') {
    const d = ev.data as {
      rationale?: string
      params?: Record<string, unknown>
    }
    return (
      <div className="mt-1 space-y-1">
        {d.rationale && (
          <div className="text-sm text-ink-soft italic">{d.rationale}</div>
        )}
        {d.params && Object.keys(d.params).length > 0 && (
          <pre className="text-xs text-ink-soft font-mono bg-card-alt rounded px-2 py-1 overflow-x-auto">
            {JSON.stringify(d.params, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  if (ev.type === 'action.impact_computed') {
    const d = ev.data as { impact_error?: string | null }
    if (d.impact_error) {
      return (
        <div className="mt-1 text-xs text-sev-crit-fg">
          {d.impact_error}
        </div>
      )
    }
  }

  return null
}

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
                  {grouped[s].map((e) => (
                    <motion.li key={e.seq} variants={traceRowEnter} className="border-l-2 border-line pl-3">
                      <div className="text-sm text-ink capitalize">{eventLabel(e)}</div>
                      <TraceDetail ev={e} />
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.section>
            ))}
        </motion.div>
      </Card>
    </PanelStateWrapper>
  )
}
