import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useFilm } from '../hooks/useFilm'
import { useCachedTriple } from '../hooks/useCachedTriple'
import { useLatestInvestigation, useFilmRuns } from '../hooks/useFilmInvestigation'
import { useRunStore, type PastRunDetail } from '@/store/runStore'
import { queryClient } from '@/api/queryClient'
import { queries } from '@/api/queries'
import { detectIsoFromLocale, isoToDashboardRegion, regionLabel, REGIONS } from '@/lib/regions'
import { MovieHero } from '../panels/MovieHero'
import { LatestInvestigation } from '../panels/LatestInvestigation'
import { PersistentAgentTrace } from '../panels/PersistentAgentTrace'
import { RunTimeline } from '../panels/RunTimeline'
import { DashboardWorkspace } from '../panels/DashboardWorkspace'
import { GlobalInjectModal } from '../shell/GlobalInjectModal'

export default function MovieDetailRoute() {
  const { filmId } = useParams()
  const id = Number(filmId ?? '0')
  const { data, isLoading, error } = useFilm(id)
  const film = data as any

  // Region drives the LatestInvestigation + RunTimeline scoping so the panel
  // matches whatever the user picked (or their auto-detected locale). Seed
  // once on mount if runStore doesn't already have one — mirrors the same
  // "personalize on landing" flow used by DashboardRoute.
  const selectedRegion = useRunStore((s) => s.selectedRegion)
  const pickRegion     = useRunStore((s) => s.pickRegion)
  useEffect(() => {
    if (selectedRegion) return
    pickRegion(isoToDashboardRegion(detectIsoFromLocale()))
  }, [selectedRegion, pickRegion])

  // Align runStore.selectedFilmId to the route's film id so useScopeMatches()
  // (which gates the right-column Investigation / Recommendation / Approval
  // panels) doesn't blank them because of a stale value left over from a
  // prior Dashboard visit. Preserves selectedRegion — unlike pickFilm(id),
  // which resets region.
  useEffect(() => {
    if (!id) return
    if (useRunStore.getState().selectedFilmId === id) return
    useRunStore.setState({ selectedFilmId: id })
  }, [id])

  // Prefer the bundled eval_cache triple (instant, richest fields).
  // Fall back to the last completed audit row for this film so the panel
  // never renders the "no run yet" empty state when there is history.
  const { data: triple } = useCachedTriple(film?.cached_scenario_id)
  const { data: latest } = useLatestInvestigation(id, selectedRegion)
  const { data: runs }   = useFilmRuns(id, selectedRegion)
  const [injectOpen, setInjectOpen] = useState(false)

  // Live run state — subscribe so the panel re-renders when a fresh crisis
  // for this film finishes. Without this the Latest Investigation card is
  // frozen on the cached sample even after Inject completes.
  const liveDetection  = useRunStore((s) => s.detection)
  const liveDecision   = useRunStore((s) => s.decision)
  const liveReport     = useRunStore((s) => s.report)
  const liveRunFilmId  = useRunStore((s) => s.currentRunFilmId)
  const liveRunId      = useRunStore((s) => s.runId)

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

  // Region-picker sync: /latest-investigation?region=X returns an audit-derived
  // triple but only carries `recommended_actions` summaries, not the full
  // `agent_run`. Fetch the run detail for its decision_id and hydrate runStore
  // via selectPastRun so Investigation / Recommendation / Approval populate
  // with THIS region's data instead of the cached seed's pinned region.
  const selectPastRun = useRunStore((s) => s.selectPastRun)
  useEffect(() => {
    if (!id || !latest) return
    const decisionId = (latest as { scenario_id?: string })?.scenario_id
    if (!decisionId) return
    const s = useRunStore.getState()
    if (s.streamState === 'streaming' || s.streamState === 'connecting') return
    if (s.runId === decisionId) return
    void queryClient
      .fetchQuery(queries.filmRunDetail(id, decisionId))
      .then((data) => selectPastRun(data as PastRunDetail))
      .catch((e) => console.error('[MovieDetail] region-sync failed', decisionId, e))
  }, [id, selectedRegion, latest, selectPastRun])

  if (isLoading) return <div data-testid="route-movie-detail" className="p-6 text-sm text-ink-soft">Loading…</div>
  if (error || !film) return <div data-testid="route-movie-detail" className="p-6 text-sm text-rose-400">Film not found.</div>

  // Build a triple-shape object from live runStore state when a fresh run
  // for THIS film has produced a detection + decision + report. This
  // "live" triple wins over any cached sample or historical audit row so
  // the panel updates the instant a crisis finishes.
  //
  // Region guard: the live run has a specific region baked in. If the
  // user has picked a *different* region from the picker, don't shove
  // the live (mismatched-region) triple into the panel — let the
  // region-scoped `latest` fetch below drive the display instead.
  const liveMatchesRegion =
    selectedRegion == null || liveDetection?.region === selectedRegion
  const liveTriple = (
    liveRunFilmId === id && liveDetection && liveDecision && liveReport
    && liveMatchesRegion
  )
    ? {
        scenario_id: liveRunId ?? 'live',
        detection: {
          film_id: liveDetection.film_id,
          region: liveDetection.region,
          metric: liveDetection.metric,
          severity: liveDetection.severity,
          magnitude: liveDetection.magnitude,
          latency_ms: (liveDetection as any).latency_ms ?? null,
        },
        investigation: null,
        decision: {
          decision_id: liveDecision.decision_id,
          status: liveDecision.status,
          recommended_actions: liveDecision.actions.map((a) => ({
            label: a.action_type,
            impact_est: a.impact_usd ?? 0,
          })),
        },
        report: liveReport,
      }
    : null

  // Preference order: live run > server-persisted history > pre-baked sample.
  // Cached samples are the LAST resort so past runs and fresh injections
  // both take priority over demo canned content.
  const investigation = (liveTriple ?? latest ?? triple ?? null) as any
  const runList = (Array.isArray(runs) ? runs : []) as any[]
  // Round-robin fallback triples come from other films' pre-run scenarios;
  // flag that clearly ONLY when we actually rendered the cached sample.
  const isSample = investigation === triple && film.cached_scenario_is_own === false

  return (
    <div data-testid="route-movie-detail" className="flex flex-col gap-6 pb-8">
      <MovieHero film={film} onInject={() => setInjectOpen(true)} />
      <div className="grid gap-6 px-6 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between rounded-md border border-line bg-card px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-soft">
              Investigation scope
            </span>
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Region
              {/* Inline picker so users can switch region context without
                  hunting for the Dashboard heat map. Uses the canonical
                  15-region list from lib/regions.ts. */}
              <select
                value={selectedRegion ?? ''}
                onChange={(e) => pickRegion(e.target.value || null)}
                className="rounded border border-line bg-card-alt px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-ink hover:border-accent focus:outline-none focus:border-accent"
                aria-label="Investigation region"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{regionLabel(r)}</option>
                ))}
              </select>
            </label>
          </div>

          <LatestInvestigation triple={investigation} sample={isSample} />
          <PersistentAgentTrace filmId={id} />
          <RunTimeline filmId={id} runs={runList} />
        </div>
        <div className="flex flex-col gap-6">
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
