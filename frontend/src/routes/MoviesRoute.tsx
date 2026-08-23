import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRegion } from '../hooks/useRegion'
import { useCatalogStore } from '../store/catalogStore'
import { queries } from '../api/queries'
import { FeaturedHero } from '../components/FeaturedHero'
import { Shelf } from '../components/Shelf'
import { AllFilmsMarquee } from '../components/AllFilmsMarquee'
import { MoviesSearchBar } from '../panels/MoviesSearchBar'

export default function MoviesRoute() {
  const region = useRegion()
  const { data, isLoading, error } = useQuery(queries.shelves(region))
  const shelves = (data ?? []) as any[]
  const setShelves = useCatalogStore((s) => s.setShelves)
  useEffect(() => { if (data) setShelves(data as any) }, [data, setShelves])
  const featured = useMemo(() => shelves.find((s) => s.id === 'featured')?.films ?? [], [shelves])

  return (
    <div data-testid="route-movies" className="flex flex-col gap-6 pb-8">
      {featured.length > 0 && <FeaturedHero films={featured} />}
      <div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Movies</h1>
        <MoviesSearchBar />
      </div>
      {isLoading && <div className="px-6 text-sm text-ink-soft">Loading shelves…</div>}
      {error && <div className="px-6 text-sm text-rose-400">Failed to load shelves.</div>}
      {shelves.map((shelf) =>
        shelf.id === 'all' ? (
          <AllFilmsMarquee key={shelf.id} title={shelf.title} films={shelf.films} />
        ) : (
          <Shelf key={shelf.id} title={shelf.title} films={shelf.films} variant="data" />
        )
      )}
    </div>
  )
}
