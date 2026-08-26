import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AgentTrace } from '@/panels/AgentTrace'
import { useRunStore } from '@/store/runStore'
import { tokens } from '@/theme/tokens'

export function TraceDrawer() {
  const [open, setOpen] = useState(false)
  const anyActive = useRunStore((s) =>
    Object.values(s.activeRuns).some((r) => r.streamState === 'streaming' || r.streamState === 'connecting'),
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="Show agent trace"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`flex h-full w-6 flex-col items-center justify-center gap-2 border-l text-[10px] font-mono uppercase tracking-widest ${
          anyActive
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-line bg-card text-ink-soft hover:text-ink'
        }`}
        style={{ writingMode: 'vertical-rl' }}
      >
        Agent Trace ▸
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40"
            />
            <motion.aside
              key="drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{
                duration: tokens.motion.duration.transition,
                ease: tokens.motion.ease.cinematic,
              }}
              className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-line bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                  Agent Trace
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close trace drawer"
                  className="text-ink-soft hover:text-ink"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <AgentTrace />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
