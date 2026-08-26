import { apiGet } from '@/api/client'
import type { RegionMetricsResponse } from '@/api/contracts'

export function fetchRegionMetrics(
  filmId: number, hours = 168,
): Promise<RegionMetricsResponse> {
  return apiGet<RegionMetricsResponse>(`/metrics/${filmId}/regions?hours=${hours}`)
}
