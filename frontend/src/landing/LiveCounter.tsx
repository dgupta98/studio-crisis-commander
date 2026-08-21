import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'

const fmt = new Intl.NumberFormat('en')

export function LiveCounter() {
  const { data } = useQuery(queries.statsSummary())
  const stats = [
    { label: 'films tracked', value: data?.films_tracked ?? 0 },
    { label: 'regions', value: data?.regions ?? 0 },
    { label: 'days history', value: data?.days_history ?? 0 },
    { label: 'rows / 24h', value: data?.rows_scanned_24h ?? 0 },
    { label: 'p50 detect ms', value: Math.round(data?.p50_detection_ms ?? 0) },
  ]
  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-1">
          <span className="font-display text-3xl tracking-tight">{fmt.format(s.value)}</span>
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">{s.label}</span>
        </div>
      ))}
    </div>
  )
}
