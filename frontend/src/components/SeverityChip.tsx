import clsx from 'clsx'
import type { ReactNode } from 'react'

export type Level = 'info' | 'warn' | 'critical' | 'replay'

const CLASS: Record<Level, string> = {
  info: 'bg-sev-info-bg text-sev-info-fg',
  warn: 'bg-sev-warn-bg text-sev-warn-fg',
  critical: 'bg-sev-crit-bg text-sev-crit-fg',
  replay: 'bg-sev-replay-bg text-sev-replay-fg',
}

export function SeverityChip({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-block px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide',
      CLASS[level],
    )}>{children}</span>
  )
}
