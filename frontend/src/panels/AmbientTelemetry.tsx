import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Props {
  signals: Record<SignalFamily, number>
}

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

export function AmbientTelemetry({ signals }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 font-display text-sm tracking-tight">Signals (last 7d)</h3>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {FAMILIES.map((family) => (
          <div key={family} className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
            <SignalChip family={family} compact />
            <span className="font-mono text-lg">{signals[family] ?? 0}</span>
            <span className="text-[10px] uppercase tracking-wider text-ink-soft">rows / 7d</span>
          </div>
        ))}
      </div>
    </section>
  )
}
