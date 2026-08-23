import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { queries } from '../api/queries'
import { tokens } from '../theme/tokens'

const fmt = new Intl.NumberFormat('en')
const EASE = tokens.motion.ease.cinematic

export function LiveCounter() {
  const { data } = useQuery(queries.statsSummary())
  const stats = [
    { label: 'films tracked', value: data?.films_tracked ?? 0 },
    { label: 'regions', value: data?.regions ?? 0 },
    { label: 'days history', value: data?.days_history ?? 0 },
    { label: 'rows ingested', value: data?.rows_scanned_24h ?? 0 },
    { label: 'p50 detect · ms', value: Math.round(data?.p50_detection_ms ?? 0) },
  ]
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-8">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: i * 0.06 }}
          className="flex min-w-0 flex-col items-start gap-2 overflow-visible"
        >
          <span
            className="max-w-full overflow-visible whitespace-nowrap font-display font-bold leading-[0.9] tracking-[-0.04em] text-ink text-[clamp(2rem,5vw,4.5rem)]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            title={fmt.format(s.value)}
          >
            {compact(s.value)}
          </span>
          <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-ink-soft">
            {s.label}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
function compact(v: number): string {
  if (v < 10_000) return fmt.format(v)
  return compactFmt.format(v)
}
