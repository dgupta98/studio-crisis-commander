import type { ReactNode } from 'react'

interface Props {
  open: boolean
  trigger: ReactNode
  children: ReactNode
  // Reserved for a future uncontrolled/self-toggling variant. Currently the
  // parent owns `open` and toggles it directly — this prop is a no-op.
  onOpenChange?: (open: boolean) => void
}

export function Popover({ open, trigger, children }: Props) {
  return (
    <div className="relative inline-block">
      {trigger}
      {open && (
        <div
          role="tooltip"
          className="absolute z-10 mt-2 left-0 min-w-[300px] max-w-[600px] bg-card border border-line rounded shadow-lg p-3"
        >
          {children}
        </div>
      )}
    </div>
  )
}
