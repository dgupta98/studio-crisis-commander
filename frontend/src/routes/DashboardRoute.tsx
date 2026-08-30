import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchDashboard } from '../api/queries'
import { useRunStore } from '@/store/runStore'
import { MovieCommand } from '../panels/MovieCommand'
import { RevenueChart } from '../panels/RevenueChart'
import { RegionalLeaderboard } from '../panels/RegionalLeaderboard'
import { TimeseriesGrid } from '../panels/TimeseriesGrid'
import { PipelineTicker } from '../panels/PipelineTicker'
import { TraceDrawer } from '../panels/TraceDrawer'
import { detectIsoFromLocale, isoToDashboardRegion, regionLabel } from '@/lib/regions'

export default function DashboardRoute() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const pickFilm = useRunStore((s) => s.pickFilm)
  const pickRegion = useRunStore((s) => s.pickRegion)

  useEffect(() => {
    prefetchDashboard(qc)
    void useRunStore.getState().loadDetections(50)
    // Seed the store from a bundled cached triple only if no run and no
    // selected film — otherwise respect what the URL or picker set.
    const { runId, report, seedFromCached, selectedFilmId, selectedRegion } = useRunStore.getState()
    if (!runId && !report && selectedFilmId === null) {
      void seedFromCached()
    }
    // Personalization: if the user hasn't picked a region yet, seed from
    // browser locale (US → NA, IN → India, GB → UK, etc.). Respects any
    // subsequent user click on the heat bar (pickRegion overrides).
    if (!selectedRegion) {
      const iso = detectIsoFromLocale()
      pickRegion(isoToDashboardRegion(iso))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc])

  useEffect(() => {
    const filmParam = params.get('film')
    const regionParam = params.get('region')
    if (filmParam) {
      const fid = Number(filmParam)
      if (Number.isFinite(fid) && fid > 0) pickFilm(fid)
    }
    if (regionParam) pickRegion(regionParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('film'), params.get('region')])

  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const detectedIso = detectIsoFromLocale()
  const detectedRegion = isoToDashboardRegion(detectedIso)

  return (
    <div data-testid="route-dashboard" className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Compact single-page layout: hero + heat → timeseries strip →
            revenue + leaderboard. Everything targets ~90vh minus chrome so
            the primary demo view doesn't require a scroll. */}
        <div className="flex-1 overflow-auto p-3">
          <div className="mx-auto flex max-w-7xl flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
                Dashboard
              </span>
              {detectedIso && (
                <span
                  className="rounded-full border border-line bg-card px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft"
                  title={`Detected from browser locale (${detectedIso}). Click any region on the heat bar to change.`}
                >
                  Region · {regionLabel(selectedRegion ?? detectedRegion)}
                </span>
              )}
            </div>
            <MovieCommand />
            <TimeseriesGrid />
            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <RevenueChart />
              <RegionalLeaderboard />
            </div>
          </div>
        </div>
        {/* Trace drawer edge — vertical tab always visible; overlay opens on click */}
        <TraceDrawer />
      </div>
      <PipelineTicker />
    </div>
  )
}
