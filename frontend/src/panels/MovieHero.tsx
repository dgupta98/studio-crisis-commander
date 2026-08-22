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
}

interface Props {
  film: Film
  onInject: () => void
}

const FAMILIES: SignalFamily[] = ['box_office', 'social', 'reviews', 'streaming']

export function MovieHero({ film, onInject }: Props) {
  return (
    <header className="relative flex flex-col gap-4 border-b border-line bg-card p-6 md:flex-row">
      <div className="w-40 flex-shrink-0 overflow-hidden rounded-md border border-line bg-card-alt">
        {film.poster_url ? (
          <img src={film.poster_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center text-xs text-ink-soft">no poster</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          {film.featured && film.cached_scenario_id && (
            <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent">
              Featured · {film.cached_scenario_id}
            </span>
          )}
          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">
            Released {film.release_date}
          </span>
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-ink">{film.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {FAMILIES.map((family) => (
            <div key={family} className="flex items-center gap-1">
              <SignalChip family={family} compact />
              <span className="font-mono text-[11px] text-ink-soft">{film.signals[family] ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onInject}
            className="rounded-md border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/20"
          >
            Inject Crisis
          </button>
          <span className="text-[11px] text-ink-soft">
            Popularity {film.popularity.toFixed(1)}
          </span>
        </div>
      </div>
    </header>
  )
}
