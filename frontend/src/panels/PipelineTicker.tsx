import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '@/lib/useReducedMotion'
import { useRunStore } from '@/store/runStore'
import { tokens } from '@/theme/tokens'

// Stage sequence — matches the SSE event vocabulary emitted by the pipeline.
// Filled dot = stage completed, hollow ring = currently running, empty = pending.
const STAGES: { key: 'detection' | 'investigation' | 'decision' | 'report'; label: string }[] = [
  { key: 'detection',     label: 'Detection' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'decision',      label: 'Decision' },
  { key: 'report',        label: 'Report' },
]

function stageDot(active: boolean, done: boolean): string {
  if (done)   return 'bg-accent'
  if (active) return 'border border-accent bg-transparent animate-pulse'
  return 'border border-line bg-transparent'
}

export function PipelineTicker() {
  const activeRuns = useRunStore((s) => s.activeRuns)
  const focusedRunId = useRunStore((s) => s.focusedRunId)
  const focusRun = useRunStore((s) => s.focusRun)
  const reduced = usePrefersReducedMotion()

  // Only show pipelines that are still doing work. Completed / errored /
  // rehydrated-from-storage runs drop off so the ticker reflects the
  // current inject rather than the entire session's run history. Past runs
  // stay accessible from Movie Detail → Past runs.
  const runIds = Object.keys(activeRuns).filter((rid) => {
    const st = activeRuns[rid]?.streamState
    return st === 'streaming' || st === 'connecting'
  })
  const visible = runIds.length > 0

  // Derive stage completion from THIS run's own events. Post per-run refactor
  // each ActiveRunState carries its own events bucket, so pill dots reflect
  // real progress for every region — not just the focused one.
  function stagesFor(rid: string) {
    const source = activeRuns[rid]?.events ?? []
    const done = new Set<string>()
    let active: string | null = null
    for (const ev of source) {
      const t = ev.type
      if (t === 'detection.completed') done.add('detection')
      if (t === 'investigation.completed') done.add('investigation')
      if (t === 'decision.completed') done.add('decision')
      if (t === 'report.completed') done.add('report')
    }
    if (!done.has('detection')) active = 'detection'
    else if (!done.has('investigation')) active = 'investigation'
    else if (!done.has('decision')) active = 'decision'
    else if (!done.has('report')) active = 'report'
    return { done, active }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ticker"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{
            duration: reduced ? 0.15 : tokens.motion.duration.transition,
            ease: tokens.motion.ease.cinematic,
          }}
          className="border-t border-line bg-card px-4 py-2"
          data-testid="pipeline-ticker"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
              {runIds.length === 1
                ? '● Pipeline Active'
                : `● ${runIds.length} Runs`}
            </span>
            {runIds.map((rid) => {
              const run = activeRuns[rid]
              const { done, active } = stagesFor(rid)
              return (
                <button
                  key={rid}
                  type="button"
                  onClick={() => focusRun(rid)}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
                    rid === focusedRunId
                      ? 'bg-card-alt text-ink'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  <span className="font-mono">
                    {run.region ?? 'Global'}
                  </span>
                  <span className="flex items-center gap-1">
                    {STAGES.map((s) => (
                      <span
                        key={s.key}
                        aria-label={`${s.label} ${done.has(s.key) ? 'done' : active === s.key ? 'in progress' : 'pending'}`}
                        className={`h-2 w-2 rounded-full ${stageDot(active === s.key, done.has(s.key))}`}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
