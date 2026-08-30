import { useMemo } from 'react'
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useRunStore } from '@/store/runStore'
import { regionLabel } from '@/lib/regions'
import { tokens } from '@/theme/tokens'

const fmtCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fmtFull    = new Intl.NumberFormat('en')

// Reshape backend box_office_daily rows into what Recharts wants: {date, revenue, cumulative}.
// Cumulative runs from the earliest date forward so the audience sees the
// total-earned line rise while the daily bars show pacing.
interface Row { ts: string; revenue_usd: number; tickets_sold: number }
interface Point { date: string; revenue: number; cumulative: number }

function buildPoints(rows: Row[]): Point[] {
  let running = 0
  return rows.map((r) => {
    const rev = Number(r.revenue_usd) || 0
    running += rev
    return { date: r.ts.slice(5, 10), revenue: rev, cumulative: running }
  })
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

  const barColor = tokens.signal.box_office.hex
  const lineColor = tokens.color.accent

  return (
    <section
      className="rounded-md border border-line bg-card p-4"
      data-testid="revenue-chart"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
            Revenue · {selectedRegion ? regionLabel(selectedRegion) : '—'}
          </span>
          <span className="font-display text-lg font-bold text-ink">
            ${fmtCompact.format(totalRevenue)} <span className="text-xs font-normal text-ink-soft">total · last 7d</span>
          </span>
        </div>
        <span className="font-mono text-[10px] text-ink-soft">
          peak day ${fmtCompact.format(dailyPeak)}
        </span>
      </div>
      {selectedFilmId === null ? (
        <EmptyState msg="Pick a movie to see revenue." />
      ) : !selectedRegion ? (
        <EmptyState msg="Pick a region on the heat bar." />
      ) : points.length === 0 ? (
        <EmptyState msg="No revenue rows for this region yet." />
      ) : (
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 12, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={tokens.color.line} strokeOpacity={0.25} vertical={false} />
              <XAxis
                dataKey="date"
                stroke={tokens.color.inkSoft}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: tokens.color.line, strokeOpacity: 0.4 }}
              />
              <YAxis
                yAxisId="left"
                stroke={tokens.color.inkSoft}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: tokens.color.line, strokeOpacity: 0.4 }}
                tickFormatter={(v) => `$${fmtCompact.format(v)}`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={tokens.color.inkSoft}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: tokens.color.line, strokeOpacity: 0.4 }}
                tickFormatter={(v) => `$${fmtCompact.format(v)}`}
              />
              <Tooltip
                contentStyle={{
                  background: tokens.color.cardAlt,
                  border: `1px solid ${tokens.color.line}`,
                  borderRadius: 4,
                  fontSize: 12,
                }}
                labelStyle={{ color: tokens.color.inkSoft, fontFamily: tokens.type.mono }}
                itemStyle={{ color: tokens.color.ink }}
                formatter={(v: number, name: string) => [
                  `$${fmtFull.format(v)}`,
                  name === 'revenue' ? 'Daily' : 'Cumulative',
                ]}
              />
              <Bar
                yAxisId="left"
                dataKey="revenue"
                fill={barColor}
                fillOpacity={0.85}
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-center text-xs text-ink-soft">
      {msg}
    </div>
  )
}
