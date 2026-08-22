import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'

export function useLatestInvestigation(filmId: number | undefined) {
  return useQuery({
    ...queries.filmLatestInvestigation(filmId ?? 0),
    enabled: filmId != null && filmId > 0,
  })
}

export function useFilmRuns(filmId: number | undefined) {
  return useQuery({
    ...queries.filmRuns(filmId ?? 0),
    enabled: filmId != null && filmId > 0,
  })
}
