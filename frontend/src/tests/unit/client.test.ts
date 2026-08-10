import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiGet, apiPost, ApiError } from '@/api/client'

const originalFetch = globalThis.fetch

beforeEach(() => { vi.stubEnv('VITE_API_URL', 'http://localhost:8000') })
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
})

describe('apiGet', () => {
  it('resolves parsed JSON on 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ hello: 'world' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const out = await apiGet<{ hello: string }>('/foo')
    expect(out).toEqual({ hello: 'world' })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toBe('http://localhost:8000/foo')
  })

  it('throws ApiError on 4xx/5xx with status + text', async () => {
    const mockFn = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
    globalThis.fetch = mockFn
    await expect(apiGet('/broken')).rejects.toBeInstanceOf(ApiError)
    try { await apiGet('/broken') } catch (e) {
      expect((e as ApiError).status).toBe(503)
      expect((e as ApiError).body).toContain('nope')
    }
  })
})

describe('apiPost', () => {
  it('sends JSON body and returns parsed response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ run_id: 'r1' }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    ))
    const out = await apiPost<{ run_id: string }>('/inject-crisis', { foo: 1 })
    expect(out.run_id).toBe('r1')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].method).toBe('POST')
    expect(call[1].body).toBe(JSON.stringify({ foo: 1 }))
    expect(call[1].headers['content-type']).toBe('application/json')
  })
})

describe('BASE()', () => {
  it('throws when VITE_API_URL is missing', async () => {
    vi.stubEnv('VITE_API_URL', '')
    await expect(apiGet('/anything')).rejects.toThrow('VITE_API_URL is not set')
  })
})
