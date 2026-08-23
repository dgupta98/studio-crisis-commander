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
      {stats.map((s, i) => {
        const { value, suffix } = splitCompact(s.value)
        return (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE, delay: i * 0.04 }}
            className="flex min-w-0 flex-col items-start gap-2 overflow-visible"
          >
            <span
              className="inline-flex max-w-full items-end overflow-visible whitespace-nowrap font-display font-bold leading-[0.9] tracking-[-0.05em] text-ink"
              style={{ fontVariantNumeric: 'tabular-nums' }}
              title={fmt.format(s.value)}
            >
              <span className="overflow-visible whitespace-nowrap text-[clamp(1.9rem,3vw,4rem)] md:text-[clamp(2.4rem,2.5vw,4.8rem)]">
                {value}
              </span>
              {suffix ? (
                <span
                  className="ml-[0.04em] inline-block translate-y-[-0.12em] text-[0.38em] leading-none tracking-[0.08em]"
                  aria-label={suffix}
                >
                  {suffix}
                </span>
              ) : null}
            </span>
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-ink-soft">
              {s.label}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
function splitCompact(v: number): { value: string; suffix: string } {
  if (v < 10_000) return { value: fmt.format(v), suffix: '' }
  const compact = compactFmt.format(v)
  const match = compact.match(/^([0-9]+(?:\.[0-9]+)?)([KMB]?)$/)
  if (!match) return { value: compact, suffix: '' }
  return { value: match[1], suffix: match[2] }
}
