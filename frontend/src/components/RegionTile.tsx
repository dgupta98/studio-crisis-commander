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

export function RegionTile({
  region, selected, activeRun, onClick, volumeScale,
}: Props) {
  const label = regionLabel(region.code)
  const abbrev = regionAbbrev(region.code)
  const tooltip = FAMILIES.map((f) => {
    const s = region.signals[f]
    const delta = s.delta_pct >= 0 ? `+${s.delta_pct}` : `${s.delta_pct}`
    return `${f}: ${s.volume.toLocaleString()} (${delta}%)`
  }).join(' · ')
  return (
    <motion.button
      type="button"
      title={`${label} — ${tooltip}`}
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
