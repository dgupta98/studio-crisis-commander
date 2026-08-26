import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchDashboard } from '../api/queries'
import { useRunStore } from '@/store/runStore'
import { MovieCommand } from '../panels/MovieCommand'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'
import { TimeseriesGrid } from '../panels/TimeseriesGrid'
import { PipelineTicker } from '../panels/PipelineTicker'
import { TraceDrawer } from '../panels/TraceDrawer'

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
    const { runId, report, seedFromCached, selectedFilmId } = useRunStore.getState()
    if (!runId && !report && selectedFilmId === null) {
      void seedFromCached()
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

  return (
    <div data-testid="route-dashboard" className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <MovieCommand />
            <DashboardWorkspace />
            <TimeseriesGrid />
          </div>
        </div>
        {/* Trace drawer edge — vertical tab always visible; overlay opens on click */}
        <TraceDrawer />
      </div>
      <PipelineTicker />
    </div>
  )
}
