import { useQuery } from '@tanstack/react-query'
import { queries } from '../api/queries'

export function useFilm(filmId: number | undefined) {
  return useQuery({
    ...queries.film(filmId ?? 0),
    enabled: filmId != null && filmId > 0,
  })
}
