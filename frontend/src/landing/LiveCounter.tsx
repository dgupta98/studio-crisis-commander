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
    <div className="grid grid-cols-2 gap-y-8 md:grid-cols-5">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: i * 0.06 }}
          className="flex flex-col items-center gap-2"
        >
          <span
            className="font-display font-light text-3xl tracking-tight md:text-4xl"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {fmt.format(s.value)}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-ink-soft">
            {s.label}
          </span>
        </motion.div>
      ))}
    </div>
  )
}
