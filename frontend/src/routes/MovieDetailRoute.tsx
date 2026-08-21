import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useFilm } from '../hooks/useFilm'
import { useCachedTriple } from '../hooks/useCachedTriple'
import { MovieHero } from '../panels/MovieHero'
import { LatestInvestigation } from '../panels/LatestInvestigation'
import { PersistentAgentTrace } from '../panels/PersistentAgentTrace'
import { RunTimeline } from '../panels/RunTimeline'
import { AmbientTelemetry } from '../panels/AmbientTelemetry'
import { GlobalInjectModal } from '../shell/GlobalInjectModal'

export default function MovieDetailRoute() {
  const { filmId } = useParams()
  const id = Number(filmId ?? '0')
  const { data, isLoading, error } = useFilm(id)
  const film = data as any
  const { data: triple } = useCachedTriple(film?.cached_scenario_id)
  const [injectOpen, setInjectOpen] = useState(false)

  if (isLoading) return <div data-testid="route-movie-detail" className="p-6 text-sm text-ink-soft">Loading…</div>
  if (error || !film) return <div data-testid="route-movie-detail" className="p-6 text-sm text-rose-400">Film not found.</div>

  return (
    <div data-testid="route-movie-detail" className="flex flex-col gap-6 pb-8">
      <MovieHero film={film} onInject={() => setInjectOpen(true)} />
      <div className="grid gap-6 px-6 md:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <LatestInvestigation triple={(triple ?? null) as any} />
          <PersistentAgentTrace />
          <RunTimeline runs={[]} />
        </div>
        <div className="flex flex-col gap-6">
          <AmbientTelemetry signals={film.signals} />
        </div>
      </div>
      <GlobalInjectModal open={injectOpen} onClose={() => setInjectOpen(false)} />
    </div>
  )
}
