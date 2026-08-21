import { useQuery } from '@tanstack/react-query'

const BASE = import.meta.env.VITE_API_URL || ''

export function useCachedTriple(scenarioId: string | null | undefined) {
  return useQuery({
    queryKey: ['cached-triple', scenarioId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/eval_cache/${scenarioId}.json`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    enabled: !!scenarioId,
    staleTime: 5 * 60_000,
  })
}
