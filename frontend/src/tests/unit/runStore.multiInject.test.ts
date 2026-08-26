import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import * as sse from '@/api/sse'

describe('runStore multi-region inject', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
    vi.restoreAllMocks()
    vi.spyOn(sse, 'openStream').mockReturnValue(() => {})
  })

  it('single-region inject returns one run_id and registers one run', async () => {
    vi.spyOn(client, 'apiPost').mockResolvedValue({
      run_id: 'r_single', stream_url: '/stream/investigation/r_single',
    })
    const ids = await useRunStore.getState().inject({
      crisisType: 'regional_sentiment_collapse',
      filmId: 1,
      region: 'Brazil',
      magnitude: 0.4,
    })
    expect(ids).toEqual(['r_single'])
    const s = useRunStore.getState()
    expect(Object.keys(s.activeRuns)).toEqual(['r_single'])
    expect(s.focusedRunId).toBe('r_single')
  })

  it('multi-region inject returns N run_ids and registers all', async () => {
    vi.spyOn(client, 'apiPost').mockResolvedValue({
      run_ids: ['r_a', 'r_b', 'r_c'],
      stream_urls: [
        '/stream/investigation/r_a',
        '/stream/investigation/r_b',
        '/stream/investigation/r_c',
      ],
    })
    const ids = await useRunStore.getState().inject({
      crisisType: 'regional_sentiment_collapse',
      filmId: 1,
      regions: ['Brazil', 'Japan', 'Korea'],
      magnitude: 0.4,
    })
    expect(ids).toEqual(['r_a', 'r_b', 'r_c'])
    const s = useRunStore.getState()
    expect(Object.keys(s.activeRuns).sort()).toEqual(['r_a', 'r_b', 'r_c'])
    expect(s.focusedRunId).toBe('r_a')  // first one focused
    expect(s.activeRuns['r_b'].region).toBe('Japan')
  })
})
