import { useState } from 'react'
import { REGIONS } from '@/lib/regions'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
}

export function MultiRegionPicker({ value, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const remaining = REGIONS.filter((r) => !value.includes(r))
  const allSelected = value.length === REGIONS.length

  return (
    <div className="rounded border border-line bg-paper p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((r) => (
          <span key={r}
            className="flex items-center gap-1 rounded bg-card-alt px-2 py-1 text-xs text-ink">
            {r}
            <button
              type="button"
              aria-label={`Remove ${r}`}
              onClick={() => onChange(value.filter((x) => x !== r))}
              className="text-ink-soft hover:text-accent"
            >
              ×
            </button>
          </span>
        ))}
        {!allSelected && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:border-accent hover:text-ink"
            >
              + Add region ▾
            </button>
            {adding && (
              <ul
                role="listbox"
                className="absolute left-0 top-full z-20 mt-1 max-h-64 w-40 overflow-auto rounded border border-line bg-card shadow-lg"
              >
                {remaining.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onChange([...value, r])
                        setAdding(false)
                      }}
                      className="w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-card-alt"
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="ml-auto">
          {allSelected ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:text-ink"
            >
              Clear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChange([...REGIONS])}
              className="rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-accent hover:bg-accent/20"
            >
              All 15
            </button>
          )}
        </div>
      </div>
      {value.length === 0 && (
        <p className="mt-1 text-[11px] text-ink-soft">Pick at least one region.</p>
      )}
    </div>
  )
}
