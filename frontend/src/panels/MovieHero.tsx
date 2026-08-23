import { SignalChip, type SignalFamily } from '../components/SignalChip'

interface Film {
  id: number
  title: string
  poster_url: string
  release_date: string
  popularity: number
  signals: Record<SignalFamily, number>
  featured: boolean
  cached_scenario_id: string | null
  language?: string
  genre?: string
  runtime_min?: number
  budget_usd?: number
  revenue_usd?: number
  vote_average?: number
}

interface Props {
  film: Film
  onInject: () => void
}

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

function formatRows(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return `${n}`
  if (n < 1_000_000)     return `${(n / 1_000).toFixed(1)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function formatRuntime(min: number): string {
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

export function MovieHero({ film, onInject }: Props) {
  const metaChips: Array<{ label: string; value: string }> = []
  if (film.genre) metaChips.push({ label: 'Genre', value: film.genre })
  if (film.runtime_min) metaChips.push({ label: 'Runtime', value: formatRuntime(film.runtime_min) })
  if (film.language) metaChips.push({ label: 'Language', value: film.language.toUpperCase() })
  if (film.vote_average) metaChips.push({ label: 'Rating', value: `${film.vote_average.toFixed(1)} / 10` })
  if (film.budget_usd) metaChips.push({ label: 'Budget', value: formatMoney(film.budget_usd) })
  if (film.revenue_usd) metaChips.push({ label: 'Box office', value: formatMoney(film.revenue_usd) })

  return (
    <header className="relative flex flex-col gap-5 border-b border-line bg-card p-6">
      <div className="flex flex-col gap-5 md:flex-row">
        <div className="w-40 flex-shrink-0 overflow-hidden rounded-md border border-line bg-card-alt">
          {film.poster_url ? (
            <img src={film.poster_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center text-xs text-ink-soft">no poster</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {film.featured && film.cached_scenario_id && (
              <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent">
                Featured · {film.cached_scenario_id}
              </span>
            )}
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">
              Released {film.release_date}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">
              Popularity {film.popularity.toFixed(1)}
            </span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-ink">{film.title}</h1>
          {metaChips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {metaChips.map((c) => (
                <MetaChip key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={onInject}
              className="rounded-md border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/20"
            >
              Inject Crisis
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {FAMILIES.map((family) => {
          const n = film.signals[family] ?? 0
          return (
            <div key={family} className="flex flex-col gap-1 rounded-md border border-line bg-card-alt p-3">
              <SignalChip family={family} compact />
              <span className="font-mono text-lg text-ink" title={`${n.toLocaleString()} rows`}>
                {formatRows(n)}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-ink-soft">rows total</span>
            </div>
          )
        })}
      </div>
    </header>
  )
}
