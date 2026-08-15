import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import type { MetricPoint } from '@/api/contracts'

interface Props {
  data: MetricPoint[]
  label: string
  color?: string
  heightPx?: number
}

export function Sparkline({ data, label, color = '#111111', heightPx = 44 }: Props) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-soft mb-1">
        {label}
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
                dot={false}
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
