import { Link } from 'react-router-dom'

interface Props {
  /** Route the mark links to. Defaults to landing. */
  to?: string
  /** Compact renders just the monogram tile (used inside AppShell where space is tight). */
  compact?: boolean
  className?: string
}

/**
 * Studio Crisis Commander brand cluster.
 *
 * Monogram tile (crimson-outlined "SCC" in the display serif) + stacked
 * uppercase wordmark. Doubles as a persistent home-link across every route.
 */
export function BrandMark({ to = '/', compact = false, className = '' }: Props) {
  return (
    <Link
      to={to}
      aria-label="Studio Crisis Commander — home"
      className={`group inline-flex items-center gap-3 ${className}`}
    >
      <span
        className="relative flex h-11 w-11 items-center justify-center rounded-md border border-accent/70 bg-black/40 font-display text-[15px] font-bold tracking-[0.06em] text-accent shadow-[0_0_24px_rgba(212,50,74,0.35)] backdrop-blur-sm transition-all group-hover:border-accent group-hover:shadow-[0_0_32px_rgba(212,50,74,0.6)]"
      >
        SCC
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-white/5"
        />
      </span>
      {!compact && (
        <span className="hidden flex-col leading-[1.05] sm:flex">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink-soft">
            Studio Crisis
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink">
            Commander
          </span>
        </span>
      )}
    </Link>
  )
}
