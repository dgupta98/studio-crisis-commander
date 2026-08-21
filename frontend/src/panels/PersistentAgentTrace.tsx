import { AgentTrace } from './AgentTrace'

export function PersistentAgentTrace() {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm tracking-tight">Agent Trace</h3>
      <div className="rounded-md border border-line bg-card">
        <AgentTrace />
      </div>
    </section>
  )
}
