interface Props {
  ms: number | null | undefined
}

export function LatencyBadge({ ms }: Props) {
  if (ms == null) return <span className="font-mono text-[10px] text-ink-soft">—</span>
  const label = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
  const tone = ms < 500 ? 'text-emerald-400' : ms < 2000 ? 'text-amber-400' : 'text-rose-400'
  return <span className={`font-mono text-[10px] ${tone}`}>{label}</span>
}
