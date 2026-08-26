import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import * as sseMod from '@/api/sse'

beforeEach(() => {
  useRunStore.getState().reset()
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('inject()', () => {
  it('POSTs /inject-crisis, sets runId, opens stream', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ run_id: 'r-xyz', stream_url: '/stream/investigation/r-xyz' })
    const openSpy = vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    const runId = await useRunStore.getState().inject({ crisisType: 'regional_sentiment_collapse' })
    expect(runId).toEqual(['r-xyz'])
    expect(useRunStore.getState().runId).toBe('r-xyz')
    expect(useRunStore.getState().streamState).toBe('connecting')
    expect(postSpy).toHaveBeenCalledWith('/inject-crisis',
      { ctype: 'regional_sentiment_collapse' })
    expect(openSpy).toHaveBeenCalledWith('r-xyz', expect.any(Function), expect.any(Function))
  })

  it('surfaces API errors — leaves runId null', async () => {
    vi.spyOn(client, 'apiPost').mockRejectedValue(new client.ApiError(503, 'down'))
    await expect(useRunStore.getState().inject()).rejects.toBeInstanceOf(client.ApiError)
    expect(useRunStore.getState().runId).toBeNull()
  })

  it('passes fallback=force through to backend', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ run_id: 'r-fb' })
    vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    await useRunStore.getState().inject({ fallback: 'force' })
    expect(postSpy).toHaveBeenCalledWith('/inject-crisis', { fallback: 'force' })
  })

  it('sends both ctype and fallback when both are set', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ run_id: 'r-both' })
    vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    await useRunStore.getState().inject({
      crisisType: 'competitor_release_impact', fallback: 'force',
    })
    expect(postSpy).toHaveBeenCalledWith('/inject-crisis',
      { ctype: 'competitor_release_impact', fallback: 'force' })
  })
})

describe('approve() / deny()', () => {
  it('approve() POSTs /approve/{id} and updates approvalStatus', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ approval_status: 'approved' })
    await useRunStore.getState().approve('d-1', 'looks good')
    expect(postSpy).toHaveBeenCalledWith('/approve/d-1',
      { approver: 'dashboard@demo', note: 'looks good' })
    expect(useRunStore.getState().approvalStatus).toBe('approved')
  })

  it('deny() POSTs /deny/{id} and updates approvalStatus', async () => {
    const postSpy = vi.spyOn(client, 'apiPost')
      .mockResolvedValue({ approval_status: 'denied' })
    await useRunStore.getState().deny('d-1', 'wrong region')
    expect(postSpy).toHaveBeenCalledWith('/deny/d-1',
      { denier: 'dashboard@demo', reason: 'wrong region' })
    expect(useRunStore.getState().approvalStatus).toBe('denied')
  })
})

describe('loadDetections()', () => {
  it('GETs /detections, populates recentDetections', async () => {
    vi.spyOn(client, 'apiGet').mockResolvedValue({
      detections: [{
        metric_ts: 't', metric: 'sentiment', film_id: 1, region: 'Brazil',
        detector: 'z', baseline_value: 0, actual_value: 0, magnitude: 0,
        business_impact: 0, severity: 5, dedup_key: 'k',
      }],
    })
    await useRunStore.getState().loadDetections(20)
    expect(useRunStore.getState().recentDetections.length).toBe(1)
    expect(useRunStore.getState().apiReachable).toBe(true)
  })

  it('sets apiReachable=false on network failure', async () => {
    vi.spyOn(client, 'apiGet').mockRejectedValue(new Error('ECONNREFUSED'))
    await useRunStore.getState().loadDetections()
    expect(useRunStore.getState().apiReachable).toBe(false)
  })
})

describe('loadMetrics()', () => {
  it('GETs /metrics/{filmId}/{region}, stores under filmId:region key', async () => {
    vi.spyOn(client, 'apiGet').mockResolvedValue({
      film_id: 1, region: 'Brazil',
      timeseries: { box_office_daily: [], social_virality_hourly: [],
                    sentiment_hourly: [], trailer_hourly: [] },
      query_latency_ms: 47,
    })
    await useRunStore.getState().loadMetrics(1, 'Brazil', 48)
    expect(useRunStore.getState().metrics['1:Brazil']).toBeDefined()
    expect(useRunStore.getState().latencyMs).toBe(47)
  })
})
