import type { QueryClient } from '@tanstack/react-query'

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE()}${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json() as Promise<T>
}

export const queries = {
  detections: () => ({
    queryKey: ['detections'] as const,
    queryFn: () => json<unknown[]>(`/detections?limit=50`),
    staleTime: 15_000,
  }),
  statsSummary: () => ({
    queryKey: ['stats', 'summary'] as const,
    queryFn: () => json<Record<string, number>>(`/stats/summary`),
    staleTime: 60_000,
  }),
  shelves: (region: string | null) => ({
    queryKey: ['catalog', 'shelves', region] as const,
    queryFn: () => json<unknown>(`/catalog/shelves${region ? `?region=${encodeURIComponent(region)}` : ''}`),
    staleTime: 60_000,
  }),
  film: (filmId: number) => ({
    queryKey: ['catalog', 'film', filmId] as const,
    queryFn: () => json<unknown>(`/catalog/films/${filmId}`),
    staleTime: 30_000,
  }),
  filmLatestInvestigation: (filmId: number, region?: string | null) => ({
    queryKey: ['catalog', 'film', filmId, 'latest', region ?? null] as const,
    queryFn: () => json<unknown>(
      region
        ? `/catalog/films/${filmId}/latest-investigation?region=${encodeURIComponent(region)}`
        : `/catalog/films/${filmId}/latest-investigation`,
    ),
    staleTime: 30_000,
  }),
  filmRuns: (filmId: number, region?: string | null) => ({
    queryKey: ['catalog', 'film', filmId, 'runs', region ?? null] as const,
    queryFn: () => json<unknown[]>(
      region
        ? `/catalog/films/${filmId}/runs?region=${encodeURIComponent(region)}`
        : `/catalog/films/${filmId}/runs`,
    ),
    staleTime: 30_000,
  }),
  filmRunDetail: (filmId: number, decisionId: string) => ({
    queryKey: ['catalog', 'film', filmId, 'run', decisionId] as const,
    queryFn: () => json<unknown>(
      `/catalog/films/${filmId}/runs/${encodeURIComponent(decisionId)}`,
    ),
    staleTime: 300_000,   // past runs are immutable, cache aggressively
  }),
}

export function prefetchDashboard(qc: QueryClient): void {
  void qc.prefetchQuery(queries.detections())
  void qc.prefetchQuery(queries.statsSummary())
}
