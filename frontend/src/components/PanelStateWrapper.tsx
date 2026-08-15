import type { PanelState } from '@/store/runStore'
import type { ReactNode } from 'react'

interface Props {
  state: PanelState
  label: string          // human name, e.g. "Anomaly Feed"
  idleLabel?: string     // optional idle placeholder text
  children: ReactNode
}

export function PanelStateWrapper({ state, label, idleLabel, children }: Props) {
  switch (state.kind) {
    case 'success':
      return <>{children}</>

    case 'loading':
      return (
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">{label}</div>
          <div data-testid="panel-skeleton"
               className="animate-pulse bg-card-alt h-16 rounded"></div>
          {state.substatus && (
            <div className="mt-2 text-sm text-ink-soft italic">{state.substatus}</div>
          )}
        </div>
      )

    case 'empty':
      return (
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">{label}</div>
          <div className="text-sm text-ink-soft">{state.hint ?? 'Nothing to show'}</div>
        </div>
      )

    case 'error':
      return (
        <div className="p-4 border-l-4 border-accent bg-card-alt">
          <div className="text-xs uppercase tracking-wider text-accent mb-2">{label} — error</div>
          <div className="text-sm text-ink mb-3">{state.message}</div>
          {state.retry && (
            <button
              type="button"
              onClick={state.retry}
              className="text-sm underline text-accent"
            >Retry</button>
          )}
        </div>
      )

    case 'idle':
    default:
      return (
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-ink-soft mb-2">{label}</div>
          <div className="text-sm text-ink-soft">{idleLabel ?? 'Idle'}</div>
        </div>
      )
  }
}
