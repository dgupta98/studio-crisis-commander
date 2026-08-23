import type { HTMLAttributes } from 'react'
import { tokens } from '../theme/tokens'

export type SignalFamily = 'box_office' | 'social' | 'reviews' | 'streaming'

const LABELS: Record<SignalFamily, string> = {
  box_office: 'Box Office',
  social: 'Social',
  reviews: 'Reviews',
  streaming: 'Streaming',
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  family: SignalFamily
  compact?: boolean
}

export function SignalChip({ family, compact, style, className, ...rest }: Props) {
  const s = tokens.signal[family]
  // Defensive: unknown families (e.g. someone passes a raw metric path like
  // "social_trends.avg_sentiment") would crash on s.fg. Render nothing
  // rather than take the whole route down.
  if (!s) return null
  return (
    <span
      {...rest}
      data-family={family}
      className={`inline-flex items-center gap-1 rounded-full border font-mono uppercase tracking-wider ${
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'
      } ${className ?? ''}`}
      style={{
        color: s.fg,
        borderColor: s.hex,
        background: `rgba(${s.rgb}, 0.08)`,
        boxShadow: `0 0 12px ${s.glow}`,
        ...style,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.hex }} />
      {LABELS[family]}
    </span>
  )
}
