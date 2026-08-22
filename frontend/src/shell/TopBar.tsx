interface Props {
  onInject: () => void
}

export function TopBar({ onInject }: Props) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-line bg-paper px-6">
      <div className="text-sm font-mono uppercase tracking-wider text-ink-soft">
        Live pipeline · Cloud Run · us-east1
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
