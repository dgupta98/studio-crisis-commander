import { EVAL } from '@/config/eval'

interface Props {
  onInject: () => void
}

export function TopBar({ onInject }: Props) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-line bg-paper px-6">
      <div className="flex items-center gap-4">
        <span className="text-sm font-mono uppercase tracking-wider text-ink-soft">
          Live pipeline · Cloud Run · us-east1
        </span>
        <EvalChip />
      </div>
      <div className="flex items-center gap-3">
        <kbd className="hidden md:inline rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft">
          ⌘ K
        </kbd>
        <button
          type="button"
          onClick={onInject}
          className="rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20"
          data-testid="top-inject-cta"
        >
          Inject Crisis
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
