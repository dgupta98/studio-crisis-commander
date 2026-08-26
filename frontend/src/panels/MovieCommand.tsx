import { useQuery } from '@tanstack/react-query'
import { queries } from '@/api/queries'
import { useRunStore } from '@/store/runStore'
import { RegionHeatBar } from '@/panels/RegionHeatBar'
import { FilmPicker } from '@/components/FilmPicker'

interface FilmDetail {
  id: number
  title: string
  poster_url: string
  release_date: string
  popularity: number
  language?: string
  genre?: string
  runtime_min?: number
  budget_usd?: number
  revenue_usd?: number
  vote_average?: number
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}
function formatRuntime(min: number | undefined): string {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded border border-line bg-card-alt px-2.5 py-1.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-ink-soft">{label}</span>
      <span className="text-[12px] font-medium text-ink">{value}</span>
    </div>
  )
}

export function MovieCommand() {
  const selectedFilmId = useRunStore((s) => s.selectedFilmId)
  const pickFilm = useRunStore((s) => s.pickFilm)

  const { data: film } = useQuery({
    ...queries.film(selectedFilmId ?? 0),
    enabled: selectedFilmId !== null,
    select: (raw) => raw as FilmDetail,
  })

  if (selectedFilmId === null) {
    return (
      <section className="rounded-md border border-line bg-card p-6 text-center">
        <div className="text-sm text-ink-soft">
          Pick a movie to see its regional performance.
        </div>
        <div className="mt-3 flex justify-center">
          <FilmPicker
            currentFilmId={null}
            currentTitle={null}
            onPick={(id) => pickFilm(id)}
          />
        </div>
      </section>
    )
  }

  const metaChips: Array<{ label: string; value: string }> = []
  if (film?.genre) metaChips.push({ label: 'Genre', value: film.genre })
  if (film?.runtime_min) metaChips.push({ label: 'Runtime', value: formatRuntime(film.runtime_min) })
  if (film?.language) metaChips.push({ label: 'Language', value: film.language.toUpperCase() })
  if (film?.vote_average) metaChips.push({ label: 'Rating', value: `${film.vote_average.toFixed(1)} / 10` })
  if (film?.budget_usd) metaChips.push({ label: 'Budget', value: formatMoney(film.budget_usd) })
  if (film?.revenue_usd) metaChips.push({ label: 'Box office', value: formatMoney(film.revenue_usd) })

  return (
    <section
      data-testid="movie-command"
      className="flex flex-col gap-5 rounded-md border border-line bg-card p-5"
    >
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-24 flex-shrink-0 overflow-hidden rounded border border-line bg-card-alt md:w-32">
          {film?.poster_url ? (
            <img src={film.poster_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center text-xs text-ink-soft">no poster</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                {film?.title ?? 'Loading…'}
              </h1>
              {film?.release_date && (
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  Released {film.release_date} · Popularity {film.popularity.toFixed(1)}
                </div>
              )}
            </div>
            <FilmPicker
              currentFilmId={selectedFilmId}
              currentTitle={film?.title ?? null}
              onPick={(id) => pickFilm(id)}
            />
          </div>
          {metaChips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {metaChips.map((c) => (
                <MetaChip key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line pt-4">
        <RegionHeatBar filmId={selectedFilmId} />
      </div>
    </section>
  )
}
