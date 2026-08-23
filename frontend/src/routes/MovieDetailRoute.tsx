import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useFilm } from '../hooks/useFilm'
import { useCachedTriple } from '../hooks/useCachedTriple'
import { useLatestInvestigation, useFilmRuns } from '../hooks/useFilmInvestigation'
import { useRunStore } from '@/store/runStore'
import { MovieHero } from '../panels/MovieHero'
import { LatestInvestigation } from '../panels/LatestInvestigation'
import { PersistentAgentTrace } from '../panels/PersistentAgentTrace'
import { RunTimeline } from '../panels/RunTimeline'
import { AmbientTelemetry } from '../panels/AmbientTelemetry'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'
import { GlobalInjectModal } from '../shell/GlobalInjectModal'

export default function MovieDetailRoute() {
  const { filmId } = useParams()
  const id = Number(filmId ?? '0')
  const { data, isLoading, error } = useFilm(id)
  const film = data as any
  // Prefer the bundled eval_cache triple (instant, richest fields).
  // Fall back to the last completed audit row for this film so the panel
  // never renders the "no run yet" empty state when there is history.
  const { data: triple } = useCachedTriple(film?.cached_scenario_id)
  const { data: latest } = useLatestInvestigation(id)
  const { data: runs } = useFilmRuns(id)
  const [injectOpen, setInjectOpen] = useState(false)

  // Hydrate runStore with THIS film's cached scenario so the right-column
  // workspace (Investigation / Recommendation / Approval) shows something
  // immediately, and Agent Trace scoping matches this movie's id.
  //
  // Skip when a run is actively streaming — clobbering it would drop the
  // user's live pipeline. Once the run is closed / errored, we may re-seed
  // on the next mount.
  const scenarioId = film?.cached_scenario_id as string | undefined
  useEffect(() => {
    if (!id || !scenarioId) return
    const s = useRunStore.getState()
    const active = s.streamState === 'streaming' || s.streamState === 'connecting'
    if (active) return
    if (s.currentRunFilmId === id && s.report) return
    void (async () => {
      const ok = await s.seedFromCached(scenarioId)
      // Round-robin fallback scenarios point at another film's detection —
      // override so scoped panels display for the page we're on.
      if (ok) useRunStore.setState({ currentRunFilmId: id })
    })()
  }, [id, scenarioId])

  if (isLoading) return <div data-testid="route-movie-detail" className="p-6 text-sm text-ink-soft">Loading…</div>
  if (error || !film) return <div data-testid="route-movie-detail" className="p-6 text-sm text-rose-400">Film not found.</div>

  const investigation = (triple ?? latest ?? null) as any
  const runList = (Array.isArray(runs) ? runs : []) as any[]
  // Round-robin fallback triples come from other films' pre-run scenarios;
  // flag that clearly so the panel doesn't imply the shown investigation
  // ran against this movie.
  const isSample = triple != null && film.cached_scenario_is_own === false

  return (
    <div data-testid="route-movie-detail" className="flex flex-col gap-6 pb-8">
      <MovieHero film={film} onInject={() => setInjectOpen(true)} />
      <div className="grid gap-6 px-6 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <LatestInvestigation triple={investigation} sample={isSample} />
          <PersistentAgentTrace filmId={id} />
          <RunTimeline runs={runList} />
        </div>
        <div className="flex flex-col gap-6">
          <AmbientTelemetry signals={film.signals} />
          {/* Same tabbed workspace as the Dashboard. Reads from runStore,
              which we seeded above with this film's scenario — so the
              investigation + recommendation are visible on mount and update
              live when a crisis is injected for this movie. */}
          <div className="min-h-[560px]">
            <DashboardWorkspace />
          </div>
        </div>
      </div>
      <GlobalInjectModal
        open={injectOpen}
        onClose={() => setInjectOpen(false)}
        defaultFilm={{ id: film.id, title: film.title }}
      />
    </div>
  )
}
