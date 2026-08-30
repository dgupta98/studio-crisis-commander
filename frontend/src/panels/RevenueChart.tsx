import { useMemo } from 'react'
import {
  Bar, Cell, CartesianGrid, ComposedChart, Line, ReferenceArea,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useRunStore } from '@/store/runStore'
import { regionLabel } from '@/lib/regions'
import { tokens } from '@/theme/tokens'

const fmtCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fmtFull    = new Intl.NumberFormat('en')

// Reshape backend box_office_daily rows into what Recharts wants:
// { date, revenue, cumulative, prev, dow }. `prev` is the previous day's
// revenue so the tooltip can render an inline delta. `dow` (0=Sun) is used
// for the subtle weekend column shading — a small cinema-industry cue since
// weekends are where box office earnings land.
interface Row { ts: string; revenue_usd: number; tickets_sold: number }
interface Point {
  date: string
  fullDate: string
  revenue: number
  cumulative: number
  prev: number
  dow: number
}

function buildPoints(rows: Row[]): Point[] {
  let running = 0
  let prev = 0
  return rows.map((r) => {
    const rev = Number(r.revenue_usd) || 0
    running += rev
    const day = new Date(r.ts + 'T00:00:00Z')
    const point: Point = {
      date: r.ts.slice(5, 10),
      fullDate: r.ts,
      revenue: rev,
      cumulative: running,
      prev,
      dow: day.getUTCDay(),
    }
    prev = rev
    return point
  })
}

// Weekend bands: contiguous Sat+Sun ranges become one ReferenceArea to reduce
// SVG chatter. Emits {x1,x2} inclusive of both endpoints so the shading is
// centered on the weekend columns.
function weekendBands(points: Point[]): Array<{ x1: string; x2: string }> {
  const bands: Array<{ x1: string; x2: string }> = []
  let start: string | null = null
  for (const p of points) {
    const isWeekend = p.dow === 0 || p.dow === 6
    if (isWeekend && start === null) start = p.date
    if (!isWeekend && start !== null) {
      // last weekend point was the previous element
      const idx = points.findIndex((q) => q.date === p.date)
      const prevPoint = idx > 0 ? points[idx - 1] : null
      if (prevPoint) bands.push({ x1: start, x2: prevPoint.date })
      start = null
    }
  }
  if (start !== null) bands.push({ x1: start, x2: points[points.length - 1].date })
  return bands
}

export function RevenueChart() {
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const metrics = useRunStore((s) => s.metrics)
  const key = selectedFilmId !== null && selectedRegion ? `${selectedFilmId}:${selectedRegion}` : null
  const res = key ? metrics[key] : undefined

  const points = useMemo(
    () => buildPoints((res?.timeseries.box_office_daily ?? []) as unknown as Row[]),
    [res],
  )

  const totalRevenue = points.length ? points[points.length - 1].cumulative : 0
  const dailyPeak = points.reduce((max, p) => Math.max(max, p.revenue), 0)
  const peakIndex = points.findIndex((p) => p.revenue === dailyPeak)
  const bands = useMemo(() => weekendBands(points), [points])

  const barColor  = tokens.signal.box_office.hex
  const barGlow   = tokens.signal.box_office.glow
  const lineColor = tokens.color.accent

  // Sci-fi backdrop: a soft blue radial glow at the top-left mimics a screen
  // gel over a dark projector booth, plus a warm crimson wash at the
  // bottom-right that matches the cumulative revenue line's climb. Kept
  // subtle (opacity ~0.07) so it doesn't fight the data.
  const cinematicBg = `
    radial-gradient(ellipse at 12% -10%, rgba(99,183,255,0.10), transparent 55%),
    radial-gradient(ellipse at 100% 120%, rgba(241,74,103,0.08), transparent 60%),
    ${tokens.color.card}
  `

  return (
    <section
      className="relative overflow-hidden rounded-md border border-line p-3"
      style={{ background: cinematicBg }}
      data-testid="revenue-chart"
    >
      {/* Scanline film-grain overlay — 2px horizontal lines at 5% opacity for
          a subtle "monitor" texture. Non-interactive. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, ${tokens.color.ink} 0 1px, transparent 1px 3px)`,
        }}
      />
      <div className="relative mb-2 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
            ▸ Revenue · {selectedRegion ? regionLabel(selectedRegion) : '—'}
          </span>
          <span className="flex items-baseline gap-1.5 font-display text-lg font-bold text-ink">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: tokens.color.accent,
                boxShadow: `0 0 8px ${tokens.color.accent}`,
                animation: 'scc-revenue-pulse 1.6s ease-in-out infinite',
              }}
            />
            ${fmtCompact.format(totalRevenue)}
            <span className="text-[10px] font-normal uppercase tracking-widest text-ink-soft">
              total · 7d
            </span>
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
            peak day
          </span>
          <span
            className="font-mono text-xs font-medium"
            style={{ color: lineColor, textShadow: `0 0 6px ${lineColor}40` }}
          >
            ${fmtCompact.format(dailyPeak)}
          </span>
        </div>
      </div>
      {selectedFilmId === null ? (
        <EmptyState msg="Pick a movie to see revenue." />
      ) : !selectedRegion ? (
        <EmptyState msg="Pick a region on the heat bar." />
      ) : points.length === 0 ? (
        <EmptyState msg="No revenue rows for this region yet." />
      ) : (
        <div className="relative" style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 12, right: 28, left: 0, bottom: 0 }}>
              <defs>
                {/* Bar gradient: bright top → deep bottom (fades into card). */}
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={barColor} stopOpacity={0.95} />
                  <stop offset="70%"  stopColor={barColor} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={barColor} stopOpacity={0.10} />
                </linearGradient>
                {/* Peak-day bar uses the accent so the biggest day pops. */}
                <linearGradient id="barGradientPeak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={lineColor} stopOpacity={1} />
                  <stop offset="70%"  stopColor={lineColor} stopOpacity={0.60} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.10} />
                </linearGradient>
                {/* Cumulative line glow — feGaussianBlur behind the stroke. */}
                <filter id="lineGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="2.2" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {/* Bar-top glow — a smaller blur so the top edge feels lit. */}
                <filter id="barGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.2" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Weekend shading — very subtle wash to mark the moneymaker days. */}
              {bands.map((b, i) => (
                <ReferenceArea
                  key={`wknd-${i}`}
                  x1={b.x1}
                  x2={b.x2}
                  yAxisId="left"
                  fill={tokens.color.ink}
                  fillOpacity={0.03}
                  ifOverflow="visible"
                />
              ))}

              <CartesianGrid
                stroke={tokens.color.line}
                strokeOpacity={0.35}
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                stroke={tokens.color.inkSoft}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: tokens.color.line, strokeOpacity: 0.5 }}
                tick={{ fontFamily: tokens.type.mono, fill: tokens.color.inkSoft, fontSize: 10 }}
              />
              <YAxis
                yAxisId="left"
                stroke={tokens.color.inkSoft}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fontFamily: tokens.type.mono, fill: tokens.color.inkSoft, fontSize: 10 }}
                tickFormatter={(v) => `$${fmtCompact.format(v)}`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={tokens.color.inkSoft}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fontFamily: tokens.type.mono, fill: tokens.color.inkSoft, fontSize: 10 }}
                tickFormatter={(v) => `$${fmtCompact.format(v)}`}
              />
              <Tooltip
                cursor={{ fill: tokens.color.ink, fillOpacity: 0.05 }}
                content={<CinematicTooltip />}
              />
              <Bar
                yAxisId="left"
                dataKey="revenue"
                radius={[3, 3, 0, 0]}
                filter="url(#barGlow)"
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              >
                {points.map((_, i) => (
                  <Cell
                    key={`bar-${i}`}
                    fill={i === peakIndex ? 'url(#barGradientPeak)' : 'url(#barGradient)'}
                    stroke={i === peakIndex ? lineColor : barColor}
                    strokeOpacity={0.4}
                    strokeWidth={0.75}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke={lineColor}
                strokeWidth={2.25}
                dot={false}
                filter="url(#lineGlow)"
                activeDot={{
                  r: 5,
                  fill: lineColor,
                  stroke: tokens.color.paper,
                  strokeWidth: 1.5,
                  style: { filter: `drop-shadow(0 0 6px ${lineColor})` },
                }}
                isAnimationActive
                animationDuration={1200}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
          {/* Bottom scanline — a single accent-colored hairline that anchors the chart floor. */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-11 right-11 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${barGlow}, transparent)`,
            }}
          />
        </div>
      )}
      {/* Keyframes for the "live" pulse dot next to the total. Kept inline so
          the RevenueChart component is self-contained (no global CSS edit). */}
      <style>{`
        @keyframes scc-revenue-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.4); opacity: 0.6; }
        }
      `}</style>
    </section>
  )
}

interface TooltipPayloadItem {
  dataKey: string
  value: number
  payload: Point
}

function CinematicTooltip({ active, payload }: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const daily = p.revenue
  const cumulative = p.cumulative
  const deltaAbs = daily - p.prev
  const deltaPct = p.prev === 0 ? (daily === 0 ? 0 : 100) : ((daily - p.prev) / p.prev) * 100
  const positive = deltaAbs >= 0
  const arrow = positive ? '▲' : '▼'
  const arrowColor = positive ? '#74db8d' : '#ff6b7a'

  return (
    <div
      className="rounded-sm border border-line font-mono text-[11px] tabular-nums"
      style={{
        background: `linear-gradient(180deg, ${tokens.color.cardAlt}, ${tokens.color.card})`,
        boxShadow: `0 8px 24px -8px rgba(0,0,0,0.6), inset 3px 0 0 ${tokens.color.accent}`,
        padding: '8px 12px 8px 14px',
        minWidth: 168,
      }}
    >
      <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-widest text-ink-soft">
        <span>{p.fullDate}</span>
        {(p.dow === 0 || p.dow === 6) && (
          <span
            className="rounded-sm px-1 py-[1px] text-[8px]"
            style={{ background: tokens.color.line, color: tokens.color.ink }}
          >
            WKND
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[9px] uppercase tracking-widest text-ink-soft">Daily</span>
        <span className="text-ink">${fmtFull.format(daily)}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-4">
        <span className="text-[9px] uppercase tracking-widest text-ink-soft">Δ prev</span>
        <span style={{ color: arrowColor }}>
          {arrow} {positive ? '+' : ''}{fmtFull.format(Math.round(deltaAbs))} ({positive ? '+' : ''}{deltaPct.toFixed(1)}%)
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-1">
        <span className="text-[9px] uppercase tracking-widest text-ink-soft">Cumul.</span>
        <span style={{ color: tokens.color.accent, textShadow: `0 0 6px ${tokens.color.accent}55` }}>
          ${fmtFull.format(cumulative)}
        </span>
      </div>
    </div>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="flex h-[180px] items-center justify-center text-center text-xs text-ink-soft">
      {msg}
    </div>
  )
}
