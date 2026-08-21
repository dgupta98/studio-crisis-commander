import { SignalChip, type SignalFamily } from '../components/SignalChip'

const AGENTS: { family: SignalFamily; title: string; body: string }[] = [
  { family: 'box_office', title: 'Detection Agent', body: 'Pure SQL over 50M+ rows. MAD-Z anomaly scoring on 5-minute windows.' },
  { family: 'social', title: 'Investigation Agent', body: 'Gemini reasons across signal families to form crisis hypotheses.' },
  { family: 'reviews', title: 'Decision Agent', body: 'Bounded action space, cost/impact estimation, ranked recommendations.' },
  { family: 'streaming', title: 'Report Agent', body: 'Executive-brief prose with SQL provenance links back to source rows.' },
]

export function AgentsFold() {
  return (
    <section className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <div className="text-center">
          <h2 className="font-display text-3xl tracking-tight">Four agents. One narrative.</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
            Each agent owns one contract and one output. Composed via Google ADK.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {AGENTS.map((a) => (
            <article key={a.family} className="flex flex-col gap-3 rounded-md border border-line bg-card p-6">
              <SignalChip family={a.family} />
              <h3 className="font-display text-xl tracking-tight">{a.title}</h3>
              <p className="text-sm text-ink-soft">{a.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
