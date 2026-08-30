import { motion } from 'framer-motion'
import { tokens } from '@/theme/tokens'
import type { RegionSummary } from '@/api/contracts'
import { regionAbbrev, regionLabel } from '@/lib/regions'

interface Props {
  region: RegionSummary
  selected: boolean
  activeRun: boolean
  onClick: (code: string) => void
  // Volume normalization scale (max volume across all 15 tiles). Passed in
  // so every tile in one Heat Bar uses the same scale — otherwise each
  // tile normalizes to its own max and the bars all look full.
  volumeScale: {
    box_office: number
    social:     number
    reviews:    number
    streaming:  number
  }
}

// Bar height range: min so an "empty" tile still shows something readable,
// max is the tile's inner body height minus padding.
const BAR_MIN_PX = 4
const BAR_MAX_PX = 44

function barHeight(vol: number, scale: number): number {
  if (scale <= 0 || vol <= 0) return BAR_MIN_PX
  return Math.max(BAR_MIN_PX, Math.round((vol / scale) * BAR_MAX_PX))
}

const FAMILIES = ['box_office', 'social', 'reviews', 'streaming'] as const

const FAMILY_TOOLTIP_LABEL: Record<(typeof FAMILIES)[number], string> = {
  box_office: 'Box office',
  social:     'Social',
  reviews:    'Sentiment',
  streaming:  'Streaming',
}

function arrow(delta: number): string {
  if (delta >= 5) return '▲'
  if (delta <= -5) return '▼'
  return '•'
}

function formatFamilyLine(family: (typeof FAMILIES)[number], s: { volume: number; delta_pct: number }): string {
  const name = FAMILY_TOOLTIP_LABEL[family]
  if (s.volume <= 0) return `${name} sparse`
  const sign = s.delta_pct >= 0 ? '+' : ''
  return `${name} ${s.volume.toLocaleString()} ${arrow(s.delta_pct)}${sign}${s.delta_pct}% vs 7d`
}

export function RegionTile({
  region, selected, activeRun, onClick, volumeScale,
}: Props) {
  const label = regionLabel(region.code)
  const abbrev = regionAbbrev(region.code)
  const tooltipLines = FAMILIES.map((f) => formatFamilyLine(f, region.signals[f]))
  const investigationLine = region.open_investigation ? ' · 1 open investigation' : ''
  const tooltip = `${label} — ${tooltipLines.join(' · ')}${investigationLine}`
  return (
    <motion.button
      type="button"
      title={tooltip}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onClick(region.code)}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={`relative flex h-[72px] w-[48px] flex-col items-center justify-between rounded border px-1 pt-1 pb-1.5 transition-colors ${
        selected
          ? 'border-accent bg-card-alt'
          : 'border-line bg-card hover:bg-card-alt'
      }`}
    >
      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-soft">
        {abbrev}
      </span>
      <div className="flex h-[48px] items-end gap-[2px]">
        {FAMILIES.map((family) => {
          const s = region.signals[family]
          const hex = tokens.signal[family].hex
          return (
            <div
              key={family}
              style={{
                height: `${barHeight(s.volume, volumeScale[family])}px`,
                width: '8px',
                background: hex,
                opacity: s.anomaly ? 1 : 0.6,
                borderRadius: '1px',
                boxShadow: s.anomaly ? `0 0 6px ${tokens.signal[family].glow}` : undefined,
              }}
            />
          )
        })}
      </div>
      {region.open_investigation && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-[6px] w-[6px] rounded-full bg-accent"
        />
      )}
      {activeRun && (
        <span
          aria-hidden
          className="absolute inset-0 rounded border border-accent animate-pulse pointer-events-none"
        />
      )}
    </motion.button>
  )
}
