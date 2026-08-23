import { useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { useRunStore } from '@/store/runStore'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { PanelStateWrapper } from '@/components/PanelStateWrapper'
import type { PanelState } from '@/store/runStore'
import { listStagger, traceRowEnter } from '@/motion/choreography'
import { regionLabel } from '@/lib/regions'
import type {
  SseEvent, Finding, Hypothesis, DetectionRow, ExecutiveReport,
} from '@/api/contracts'

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

function formatImpact(usd: number | null | undefined): string {
  if (typeof usd !== 'number') return '—'
  if (usd === 0) return 'no measurable delta'
  return `$${Math.round(usd).toLocaleString()}`
}

function eventLabel(ev: SseEvent): string {
  if (ev.type === 'signal.completed') {
    const sig = (ev.data as { finding?: { signal?: string } }).finding?.signal
    return sig ? `signal: ${sig.replace(/_/g, ' ')}` : 'signal completed'
  }
  if (ev.type === 'hypothesis.formed') return 'hypothesis formed'
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
    return `impact ${formatImpact(d.impact_usd)}: ${d.action_type ?? ''}`
  }
  if (ev.type === 'detection.started') {
    const c = (ev.data as { crisis?: { type?: string } }).crisis
    return c?.type ? `injecting ${c.type.replace(/_/g, ' ')}` : 'detection started'
  }
  if (
    ev.type === 'investigation.tool_called'
    || ev.type === 'decision.tool_called'
    || ev.type === 'report.tool_called'
  ) {
    const d = ev.data as { author?: string; tool?: string }
    const who = d.author ? d.author.replace(/_/g, ' ') : 'agent'
    return `${who} calls ${d.tool ?? 'tool'}`
  }
  if (
    ev.type === 'investigation.thought'
    || ev.type === 'decision.thought'
    || ev.type === 'report.thought'
  ) {
    const d = ev.data as { author?: string }
    const who = d.author ? d.author.replace(/_/g, ' ') : 'agent'
    return `${who} thinking…`
  }
  const parts = ev.type.split('.')
  return parts[parts.length - 1].replace(/_/g, ' ')
}

const STAGE_ORDER: Stage[] = ['Detection', 'Investigation', 'Decision', 'Report', 'Pipeline']

function TraceDetail({ ev }: { ev: SseEvent }) {
  if (ev.type === 'detection.started') {
    const c = (ev.data as {
      crisis?: {
        type?: string
        film_id?: number
        region?: string
        magnitude?: number
        true_root_cause?: string
        expected_recommendation?: string
        affected_tables?: string[]
      }
    }).crisis
    if (!c) return null
    const subject = c.film_id !== undefined
      ? `Film ${c.film_id}${c.region ? ` · ${regionLabel(c.region)}` : ''}`
      : ''
    return (
      <div className="mt-1 space-y-1">
        {c.type && (
          <div className="text-sm text-ink">
            <span className="text-ink-soft">Scenario · </span>
            <span className="font-mono">{c.type}</span>
          </div>
        )}
        {subject && (
          <div className="text-sm text-ink">
            <span className="text-ink-soft">Subject · </span>{subject}
          </div>
        )}
        {typeof c.magnitude === 'number' && (
          <div className="text-xs text-ink-soft">
            magnitude <span className="font-mono tabular-nums text-ink">
              {c.magnitude.toFixed(2)}
            </span>
          </div>
        )}
        {c.true_root_cause && (
          <div className="text-xs text-ink-soft italic">
            Ground-truth cause: {c.true_root_cause}
          </div>
        )}
        {c.affected_tables && c.affected_tables.length > 0 && (
          <div className="text-xs text-ink-soft">
            Tables touched:{' '}
            <span className="font-mono text-ink">
              {c.affected_tables.join(', ')}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (ev.type === 'detection.completed') {
    const d = (ev.data as { detection?: Partial<DetectionRow> }).detection
    if (!d) return null
    // Wire shape is authoritative in prod; tests seed a partial fixture so
    // we guard each numeric field before .toFixed rather than crash.
    const num = (v: number | undefined, digits: number) =>
      typeof v === 'number' ? v.toFixed(digits) : '—'
    const subject = d.film_title
      ? d.film_title
      : d.film_id !== undefined ? `Film ${d.film_id}` : 'Unknown film'
    return (
      <div className="mt-1 space-y-1">
        {d.metric && (
          <div className="text-sm text-ink">
            <span className="text-ink-soft">Metric · </span>
            <span className="font-mono">{d.metric}</span>
          </div>
        )}
        <div className="text-sm text-ink">
          <span className="text-ink-soft">Subject · </span>
          {subject}{d.region ? ` · ${regionLabel(d.region)}` : ''}
        </div>
        <div className="flex gap-4 text-xs text-ink-soft">
          <span>severity <span className="font-mono tabular-nums text-ink">{num(d.severity, 1)}</span></span>
          <span>magnitude <span className="font-mono tabular-nums text-ink">{num(d.magnitude, 2)}</span></span>
          <span>actual <span className="font-mono tabular-nums text-ink">{num(d.actual_value, 2)}</span></span>
          <span>baseline <span className="font-mono tabular-nums text-ink">{num(d.baseline_value, 2)}</span></span>
        </div>
      </div>
    )
  }

  if (ev.type === 'signal.completed') {
    const finding = (ev.data as { finding?: Finding }).finding
    if (!finding) return null
    return (
      <>
        {finding.sql && (
          <div className="mt-1 min-w-0 max-w-full overflow-hidden">
            <SqlBlock sql={finding.sql} />
          </div>
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
          <pre className="text-xs text-ink-soft font-mono bg-card-alt rounded px-2 py-1 whitespace-pre-wrap break-all max-w-full">
            {JSON.stringify(d.params, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  if (ev.type === 'action.impact_computed') {
    const d = ev.data as {
      impact_error?: string | null
      impact_usd?: number | null
    }
    if (d.impact_error) {
      return (
        <div className="mt-1 text-xs text-sev-crit-fg">
          {d.impact_error}
        </div>
      )
    }
    if (d.impact_usd === 0) {
      return (
        <div className="mt-1 text-xs text-ink-soft italic">
          Impact SQL returned 0 — likely no view/spend delta between variants
          in the last 7 days.
        </div>
      )
    }
    return null
  }

  if (ev.type === 'report.completed') {
    const r = (ev.data as { report?: ExecutiveReport }).report
    if (!r) return null
    return (
      <div className="mt-1 space-y-1">
        <div className="text-sm text-ink font-medium">{r.headline}</div>
        <div className="text-sm text-ink-soft italic">{r.tldr}</div>
      </div>
    )
  }

  if (
    ev.type === 'investigation.tool_called'
    || ev.type === 'decision.tool_called'
    || ev.type === 'report.tool_called'
  ) {
    const d = ev.data as { tool?: string; args_preview?: string }
    if (!d.tool) return null
    return (
      <div className="mt-1 space-y-1">
        <div className="text-xs text-ink-soft">
          Tool <span className="font-mono text-ink">{d.tool}</span>
        </div>
        {d.args_preview && (
          <pre className="text-xs text-ink-soft font-mono bg-card-alt rounded px-2 py-1 whitespace-pre-wrap break-all max-w-full">
            {d.args_preview}
          </pre>
        )}
      </div>
    )
  }

  if (
    ev.type === 'investigation.thought'
    || ev.type === 'decision.thought'
    || ev.type === 'report.thought'
  ) {
    const d = ev.data as { text?: string }
    if (!d.text) return null
    return (
      <div className="mt-1 text-xs text-ink-soft italic whitespace-pre-wrap">
        {d.text}
      </div>
    )
  }

  if (ev.type === 'pipeline.completed') {
    const d = ev.data as { latency_ms?: number; mode?: string }
    return (
      <div className="mt-1 text-xs text-ink-soft">
        Mode <span className="font-mono text-ink">{d.mode ?? '—'}</span>
        {typeof d.latency_ms === 'number' && (
          <> · Total <span className="font-mono tabular-nums text-ink">
            {(d.latency_ms / 1000).toFixed(2)}s
          </span></>
        )}
      </div>
    )
  }

  return null
}

export function AgentTrace({ filmId }: { filmId?: number } = {}) {
  const state = useRunStore((s) => s.panelStates.trace)
  const allEvents = useRunStore((s) => s.events)
  const currentRunFilmId = useRunStore((s) => s.currentRunFilmId)

  // When mounted inside Movie Detail, scope the trace to THIS film. The
  // store is a global singleton, so an active run for film A would
  // otherwise bleed into every /movies/B page.
  //
  // We compare against `currentRunFilmId` (set at inject-time) rather than
  // `detection.film_id` (which only populates after detection.completed).
  // Otherwise a run that hangs at detection.started — or one still in
  // flight — would falsely miss the match on its own film's page.
  const isScoped = typeof filmId === 'number'
  const scopedMatch = isScoped && currentRunFilmId === filmId
  const events = !isScoped || scopedMatch ? allEvents : []
  const effectiveState: PanelState = isScoped && !scopedMatch
    ? { kind: 'empty', hint: 'No live run for this film yet — press Inject Crisis to start one.' }
    : state

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

  // Auto-scroll to the latest event so the tail stays visible without the
  // user having to chase it. Only scroll if the user is already near the
  // bottom — otherwise they're reading earlier events and shouldn't be
  // yanked away.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) el.scrollTop = el.scrollHeight
  }, [events.length])

  return (
    <PanelStateWrapper state={effectiveState} label="Agent Trace" idleLabel="Idle · press Inject to begin">
      {/* Fixed viewport so trace can't stretch the page as events stream in.
          Header stays put; only the event list scrolls. */}
      <Card data-testid="agent-trace" className="p-4 flex flex-col h-[calc(100vh-14rem)] min-h-[480px] max-h-[820px]">
        <div className="text-xs uppercase tracking-wider text-ink-soft mb-4 shrink-0">
          Live Agent Trace
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pr-2">
          <motion.div variants={listStagger} initial="hidden" animate="visible" className="space-y-6">
            {STAGE_ORDER
              .filter((s) => grouped[s].length > 0)
              .map((s) => (
                <motion.section key={s} variants={traceRowEnter}>
                  <h3 className="font-display text-lg font-semibold tracking-tight text-ink mb-2">{s}</h3>
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
        </div>
      </Card>
    </PanelStateWrapper>
  )
}
