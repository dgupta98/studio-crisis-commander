import { LatencyBadge } from '../components/LatencyBadge'
import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Triple {
  scenario_id: string
  detection: any
  investigation: any
  decision: any
  report: any
}

interface Props {
  triple: Triple | null
}

export function LatestInvestigation({ triple }: Props) {
  if (!triple) {
    return (
      <div className="rounded-md border border-line bg-card p-6 text-sm text-ink-soft">
        No run yet — click <strong>Inject Crisis</strong> above to start one.
      </div>
    )
  }
  const det = triple.detection ?? {}
  const dec = triple.decision ?? {}
  const rep = triple.report ?? {}
  const metric = det.metric as SignalFamily | undefined
  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-card p-6">
      <div className="flex items-center gap-3">
        {metric && <SignalChip family={metric} compact />}
        <span className="font-mono text-xs uppercase tracking-wider text-ink-soft">
          {det.region ?? '—'} · severity {det.severity ?? '—'} · magnitude {Number(det.magnitude ?? 0).toFixed(1)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="text-[10px] uppercase text-ink-soft">latency</span>
          <LatencyBadge ms={det.latency_ms ?? null} />
        </span>
      </div>
      <h2 className="font-display text-xl tracking-tight text-ink">{rep.headline ?? '—'}</h2>
      {(rep.tldr || rep.body) && <p className="text-sm text-ink-soft">{rep.tldr ?? rep.body}</p>}
      {Array.isArray(dec.recommended_actions) && dec.recommended_actions.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-3">
          {dec.recommended_actions.map((a: any, i: number) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span>{a.label ?? a.name ?? '(action)'}</span>
              <span className="font-mono text-xs text-emerald-400">
                +{Number(a.impact_est ?? 0).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
