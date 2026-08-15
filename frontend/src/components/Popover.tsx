import type { ReactNode } from 'react'

interface Props {
  open: boolean
  trigger: ReactNode
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

export function Popover({ open, trigger, children }: Props) {
  return (
    <span className="relative inline-block">
      {trigger}
      {open && (
        <span className="absolute z-10 mt-2 left-0 min-w-[300px] max-w-[600px] bg-card border border-line rounded shadow-lg p-3">
          {children}
        </span>
      )}
    </span>
  )
}
