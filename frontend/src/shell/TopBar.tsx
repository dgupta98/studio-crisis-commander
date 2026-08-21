interface Props {
  onInject: () => void
}

export function TopBar({ onInject }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-paper px-4">
      <div className="text-xs font-mono uppercase tracking-wider text-ink-soft">
        Live pipeline · Cloud Run · us-east1
      </div>
      <div className="flex items-center gap-3">
        <kbd className="hidden md:inline rounded border border-line bg-card px-1.5 py-0.5 text-[10px] text-ink-soft">
          ⌘ K
        </kbd>
        <button
          type="button"
          onClick={onInject}
          className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
          data-testid="top-inject-cta"
        >
          Inject Crisis
        </button>
      </div>
    </header>
  )
}
