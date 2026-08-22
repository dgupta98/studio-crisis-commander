import { AgentTrace } from './AgentTrace'

export function PersistentAgentTrace({ filmId }: { filmId?: number } = {}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm font-semibold tracking-tight text-ink">Agent Trace</h3>
      <div className="rounded-md border border-line bg-card">
        <AgentTrace filmId={filmId} />
      </div>
    </section>
  )
}
