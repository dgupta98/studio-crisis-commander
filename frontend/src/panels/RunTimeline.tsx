interface Run {
  run_id: string
  at: string
  ctype: string
  magnitude: number
  severity: string
}

export function RunTimeline({ runs }: { runs: Run[] }) {
  if (!runs.length) {
    return <div className="rounded-md border border-line bg-card p-4 text-xs text-ink-soft">No past runs.</div>
  }
  return (
    <section className="flex flex-col gap-2">
<<<<<<< HEAD
      <h3 className="px-1 font-body text-sm font-semibold tracking-tight text-ink">Past runs</h3>
=======
      <h3 className="px-1 font-display text-sm font-semibold tracking-tight text-ink">Past runs</h3>
>>>>>>> 5625b8c (font changes)
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
        {runs.map((r) => (
          <li key={r.run_id} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="font-mono text-ink-soft">{new Date(r.at).toLocaleString()}</span>
            <span>{r.ctype}</span>
            <span className="font-mono">Δ {r.magnitude.toFixed(2)}</span>
            <span className="font-mono uppercase text-ink-soft">{r.severity}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
