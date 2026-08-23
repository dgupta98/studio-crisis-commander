import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Props {
  signals: Record<SignalFamily, number>
}

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

// Match IntakeStrip: total counts are large, so compact to K/M/B or the
// tile overflows on a narrow sidebar.
function formatRows(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

export function AmbientTelemetry({ signals }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm font-semibold tracking-tight text-ink">Signals total</h3>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {FAMILIES.map((family) => {
          const n = signals[family] ?? 0
          return (
            <div key={family} className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
              <SignalChip family={family} compact />
              <span className="font-mono text-lg" title={`${n.toLocaleString()} rows`}>
                {formatRows(n)}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-ink-soft">rows total</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
