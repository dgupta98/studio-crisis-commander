import { useEffect, useRef, useState } from 'react'

// Themed dropdown that matches the app's dark surface everywhere it's used.
// Native <select>'s popup is rendered by the OS (light Aqua panel on macOS)
// and cannot be styled to match — every option would appear on pale gray
// against the dark theme. This component paints its own listbox so the
// dropdown reads as part of the app, not an OS overlay.
//
// Extracted from GlobalInjectModal so MovieDetail's Investigation-Scope
// region picker can reuse the same visual language.
interface Props<T extends string> {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  ariaLabel: string
  buttonClass?: string
  listClass?: string
}

export function ThemedSelect<T extends string>({
  value, onChange, options, ariaLabel,
  buttonClass = '', listClass = '',
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded border border-line bg-paper px-2 py-1.5 text-left text-sm outline-none focus:border-accent flex items-center justify-between gap-2 ${buttonClass}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <span className="text-ink-soft text-[10px] shrink-0">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded border border-line bg-card shadow-lg ${listClass}`}
        >
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(o.value)
                setOpen(false)
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${
                o.value === value
                  ? 'bg-card-alt text-accent'
                  : 'text-ink hover:bg-card-alt'
              }`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
