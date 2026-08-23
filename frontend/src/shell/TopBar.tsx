import { EVAL } from '@/config/eval'

interface Props {
  onInject: () => void
  onOpenNav?: () => void
}

export function TopBar({ onInject, onOpenNav }: Props) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-line bg-paper px-4 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Mobile-only hamburger. Hidden on md+ where LeftNav is persistent. */}
        {onOpenNav && (
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onOpenNav}
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-card text-ink-soft hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <span className="hidden sm:inline text-sm font-mono uppercase tracking-wider text-ink-soft truncate">
          Live pipeline · Cloud Run · us-east1
        </span>
        <span className="sm:hidden text-xs font-mono uppercase tracking-wider text-ink-soft truncate">
          SCC · live
        </span>
        <EvalChip />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <kbd className="hidden lg:inline rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft">
          ⌘ K
        </kbd>
        <button
          type="button"
          onClick={onInject}
          className="rounded-md border border-accent bg-accent/10 px-3 py-2 text-xs sm:text-sm font-medium text-accent hover:bg-accent/20 sm:px-4"
          data-testid="top-inject-cta"
        >
          <span className="sm:hidden">Inject</span>
          <span className="hidden sm:inline">Inject Crisis</span>
        </button>
      </div>
    </header>
  )
}

function EvalChip() {
  const pending = EVAL.verified === null
  const label = pending
    ? `Eval harness · ${EVAL.total} scenarios · pending`
    : `Eval · ${EVAL.verified}/${EVAL.total} verified`
  const title = pending
    ? 'Run ./scripts/eval_replay.py and update frontend/src/config/eval.ts'
    : `Reproducible: ./scripts/eval_replay.py · run ${EVAL.runDate ?? ''}`
  return (
    <span
      className={
        'hidden md:inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ' +
        (pending
          ? 'border-line bg-card text-ink-soft'
          : 'border-accent/40 bg-accent/10 text-accent')
      }
      title={title}
    >
      <span
        className={
          'inline-block h-1.5 w-1.5 rounded-full ' +
          (pending ? 'bg-ink-soft' : 'bg-accent')
        }
      />
      {label}
    </span>
  )
}
