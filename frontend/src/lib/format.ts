// Prettify a metric value string that the report agent may have emitted at
// full float precision (e.g. "0.003351134846461949").
//
// Rules:
//   • Non-numeric strings pass through unchanged (already formatted, ISO date,
//     "N/A", etc).
//   • Ratios < 1 render as a percent with 2 decimals ("0.34%").
//   • Values ≥ 1_000_000 render as $X.YM.
//   • Values ≥ 1_000 render as $X.YK.
//   • Everything else gets 2 decimal places.
// The heuristic is deliberately loose — key figures are always headline
// numbers, so a small formatting miss is preferable to a wall of digits.
const NUMERIC_ONLY = /^-?\d+(\.\d+)?$/
const CURRENCY_PREFIX = /^\$?-?\d+(\.\d+)?$/

export function humanizeMetric(raw: string): string {
  if (raw == null) return raw
  const s = String(raw).trim()
  const numeric = NUMERIC_ONLY.test(s) || CURRENCY_PREFIX.test(s)
  if (!numeric) return s
  const n = Number(s.replace(/^\$/, ''))
  if (!Number.isFinite(n)) return s
  const hadDollar = s.startsWith('$')
  const abs = Math.abs(n)

  if (!hadDollar && abs > 0 && abs < 1) {
    return `${(n * 100).toFixed(2)}%`
  }
  const fmt = (v: number, digits: number) =>
    v.toLocaleString(undefined, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    })
  if (abs >= 1_000_000_000) return `${hadDollar ? '$' : ''}${fmt(n / 1e9, 2)}B`
  if (abs >= 1_000_000)     return `${hadDollar ? '$' : ''}${fmt(n / 1e6, 2)}M`
  if (abs >= 1_000)         return `${hadDollar ? '$' : ''}${fmt(n / 1e3, 2)}K`
  return `${hadDollar ? '$' : ''}${fmt(n, 2)}`
}
