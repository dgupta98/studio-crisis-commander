const STEPS = [
  { n: '01', title: 'Signals land', body: 'ClickHouse ingest across 4 families. Detection is pure SQL on 5-min rollups.' },
  { n: '02', title: 'Agents reason', body: 'Investigation → Decision → Report chain runs on Gemini via ADK.' },
  { n: '03', title: 'Human decides', body: 'Recommended actions land in your Approval Gate with full provenance.' },
]

export function HowItWorksFold() {
  return (
    <section className="flex min-h-screen items-center justify-center bg-card/40 px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <h2 className="text-center font-display text-3xl tracking-tight">How it works</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col gap-3 border-l-2 border-accent px-4">
              <span className="font-mono text-xs text-accent">{s.n}</span>
              <h3 className="font-display text-lg tracking-tight">{s.title}</h3>
              <p className="text-sm text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
