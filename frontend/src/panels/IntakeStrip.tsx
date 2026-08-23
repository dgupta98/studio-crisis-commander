import { motion } from 'framer-motion'
import { useIntakeRates } from '../hooks/useIntakeRates'
import { useSignalStore } from '../store/signalStore'
import { SignalChip, type SignalFamily } from '../components/SignalChip'

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

// Compact big totals so a 28,340,912 row count doesn't overflow the tile.
function formatRows(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

export function IntakeStrip() {
  useIntakeRates()
  const rates = useSignalStore((s) => s.rates)
  const history = useSignalStore((s) => s.history)
  return (
    <div
      className="grid grid-cols-2 gap-3 border-b border-line bg-card px-4 py-3 sm:gap-4 sm:px-6 sm:py-4 md:grid-cols-4"
      data-testid="intake-strip"
    >
      {FAMILIES.map((family) => (
        <div
          key={family}
          className="flex items-center gap-3 rounded-md border border-line bg-paper px-3 py-3 sm:gap-4 sm:px-4"
        >
          <SignalChip family={family} compact />
          <div className="flex min-w-0 flex-col">
            <motion.span
              key={rates[family]}
              initial={{ opacity: 0.5, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="font-mono text-xl leading-none sm:text-2xl"
              title={`${rates[family].toLocaleString()} rows`}
            >
              {formatRows(rates[family])}
            </motion.span>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-ink-soft sm:text-xs">
              rows total
            </span>
          </div>
          <div className="ml-auto hidden sm:block">
            <MiniSparkline points={history[family]} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MiniSparkline({ points }: { points: number[] }) {
  if (!points.length) return <span className="flex-1" />
  const max = Math.max(1, ...points)
  const w = 80
  const h = 28
  const step = w / Math.max(1, points.length - 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${h - (p / max) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="opacity-70">
      <path d={d} stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  )
}
