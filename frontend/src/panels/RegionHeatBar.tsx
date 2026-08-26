import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { fetchRegionMetrics } from '@/api/regionMetrics'
import { REGIONS } from '@/lib/regions'
import { tokens } from '@/theme/tokens'
import { RegionTile } from '@/components/RegionTile'
import { useRunStore } from '@/store/runStore'
import type { RegionMetricsResponse, RegionSummary } from '@/api/contracts'

interface Props {
  filmId: number
}

// Placeholder region row (all-zero) — rendered while the query is loading
// so the bar's height and shape stay stable and the cascade animation
// doesn't shift the layout when data lands.
function emptyRegion(code: string): RegionSummary {
  return {
    code,
    signals: {
      box_office: { volume: 0, delta_pct: 0, anomaly: false },
      social:     { volume: 0, delta_pct: 0, anomaly: false },
      reviews:    { volume: 0, delta_pct: 0, anomaly: false },
      streaming:  { volume: 0, delta_pct: 0, anomaly: false },
    },
    open_investigation: false,
  }
}

function mergeToCanonical(res: RegionMetricsResponse | undefined): RegionSummary[] {
  const byCode = new Map<string, RegionSummary>()
  for (const r of res?.regions ?? []) byCode.set(r.code, r)
  return REGIONS.map((code) => byCode.get(code) ?? emptyRegion(code))
}

export function RegionHeatBar({ filmId }: Props) {
  const { data } = useQuery({
    queryKey: ['region-metrics', filmId],
    queryFn: () => fetchRegionMetrics(filmId, 168),
    staleTime: 60_000,
  })
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const activeRuns = useRunStore((s) => s.activeRuns)
  const pickRegion = useRunStore((s) => s.pickRegion)

  const regions = useMemo(() => mergeToCanonical(data), [data])
  const volumeScale = useMemo(() => {
    const max = { box_office: 0, social: 0, reviews: 0, streaming: 0 }
    for (const r of regions) {
      max.box_office = Math.max(max.box_office, r.signals.box_office.volume)
      max.social     = Math.max(max.social,     r.signals.social.volume)
      max.reviews    = Math.max(max.reviews,    r.signals.reviews.volume)
      max.streaming  = Math.max(max.streaming,  r.signals.streaming.volume)
    }
    return max
  }, [regions])

  const activeRegions = useMemo(() => {
    const s = new Set<string>()
    for (const rid of Object.keys(activeRuns)) {
      const ar = activeRuns[rid]
      if (ar.region && ar.streamState !== 'closed') s.add(ar.region)
    }
    return s
  }, [activeRuns])

  const ease = tokens.motion.ease.cinematic

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
          Region heat · 15 markets
        </span>
        {data && (
          <span className="font-mono text-[10px] text-ink-soft">
            {data.query_latency_ms}ms
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Region heat bar">
        {regions.map((r, i) => (
          <motion.div
            key={r.code}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: i * 0.025, duration: 0.35, ease }}
          >
            <RegionTile
              region={r}
              selected={selectedRegion === r.code}
              activeRun={activeRegions.has(r.code)}
              onClick={(code) => pickRegion(selectedRegion === code ? null : code)}
              volumeScale={volumeScale}
            />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
