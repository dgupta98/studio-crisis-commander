import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import type { MetricPoint } from '@/api/contracts'

interface Props {
  data: MetricPoint[]
  label: string
  color?: string
  heightPx?: number
}

export function Sparkline({ data, label, color = '#111111', heightPx = 44 }: Props) {
  // Sparse series (2-3 points over a wide window) rendered as a nearly-flat
  // 1.5px line that looked "empty" — the dashboard bug the user reported.
  // Draw dots when the series is sparse so at least the points are visible.
  const sparse = data.length > 0 && data.length < 8
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-soft mb-1">
        {label}
        {data.length > 0 && data.length < 8 && (
          <span className="ml-1 normal-case tracking-normal text-ink-soft/70">
            · {data.length} pt{data.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {data.length === 0 ? (
        <div style={{ height: heightPx }}
             className="flex items-center text-xs text-ink-soft italic">
          no data
        </div>
      ) : (
        <div style={{ height: heightPx }}>
          {/* ResponsiveContainer gives 0-width in jsdom; LineChart still renders SVG via explicit dimensions */}
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              width={300}
              height={heightPx}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={sparse ? { r: 2, fill: color } : false}
                isAnimationActive={true}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
