import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRegion } from '../hooks/useRegion'
import { useCatalogStore } from '../store/catalogStore'
import { queries } from '../api/queries'
import { FeaturedHero } from '../components/FeaturedHero'
import { Shelf } from '../components/Shelf'
import { AllFilmsMarquee } from '../components/AllFilmsMarquee'
import { MoviesSearchBar } from '../panels/MoviesSearchBar'
import { isoToDashboardRegion, regionLabel } from '@/lib/regions'

// The backend shelf titles arrive as "Trending in IN" / "Trending in US" with
// the raw ISO code. Rewrite to the full country/region name so the shelf
// reads "Trending in India" / "Trending in North America".
function humanizeShelfTitle(title: string, region: string | null | undefined): string {
  if (!region) return title
  const iso = region.toUpperCase()
  const dashboardRegion = isoToDashboardRegion(iso)
  const humanName = regionLabel(dashboardRegion)
  return title.replace(new RegExp(`\\b${iso}\\b`), humanName)
}

export default function MoviesRoute() {
  const region = useRegion()
  const { data, isLoading, error } = useQuery(queries.shelves(region))
  const shelves = (data ?? []) as any[]
  const setShelves = useCatalogStore((s) => s.setShelves)
  useEffect(() => { if (data) setShelves(data as any) }, [data, setShelves])
  const featured = useMemo(() => shelves.find((s) => s.id === 'featured')?.films ?? [], [shelves])
  const detectedRegionName = region ? regionLabel(isoToDashboardRegion(region)) : null

  return (
    <div data-testid="route-movies" className="flex flex-col gap-6 pb-8">
      {featured.length > 0 && <FeaturedHero films={featured} />}
      <div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Movies</h1>
        <div className="flex items-center gap-3">
          {detectedRegionName && (
            <span
              className="rounded-full border border-line bg-card px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-soft"
              title={`Detected from browser locale (${region}). Shelves below are ranked for your region.`}
            >
              Region · {detectedRegionName}
            </span>
          )}
          <MoviesSearchBar />
        </div>
      </div>
      {isLoading && <div className="px-6 text-sm text-ink-soft">Loading shelves…</div>}
      {error && <div className="px-6 text-sm text-rose-400">Failed to load shelves.</div>}
      {shelves.map((shelf) => {
        const title = humanizeShelfTitle(shelf.title, region)
        return shelf.id === 'all' ? (
          <AllFilmsMarquee key={shelf.id} title={title} films={shelf.films} />
        ) : (
          <Shelf key={shelf.id} title={title} films={shelf.films} variant="data" />
        )
      })}
    </div>
  )
}
