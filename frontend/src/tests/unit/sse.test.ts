import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openStream } from '@/api/sse'

class MockEventSource {
  static instances: MockEventSource[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  readyState = 0
  url: string
  closed = false
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this) }
  emit(payload: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }
  fireError() { this.onerror?.(new Event('error')) }
  close() { this.closed = true }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
  ;(globalThis as unknown as { EventSource: typeof MockEventSource })
    .EventSource = MockEventSource
})
afterEach(() => { vi.unstubAllEnvs() })

describe('openStream', () => {
  it('opens EventSource at /stream/investigation/{runId}', () => {
    openStream('r-1', () => {}, () => {})
    expect(MockEventSource.instances[0].url)
      .toBe('http://localhost:8000/stream/investigation/r-1')
  })

  it('parses SSE messages and invokes onEvent', () => {
    const events: unknown[] = []
    openStream('r-2', (e) => events.push(e), () => {})
    MockEventSource.instances[0].emit({ seq: 0, type: 'x', data: {}, ts: 't' })
    expect(events).toEqual([{ seq: 0, type: 'x', data: {}, ts: 't' }])
  })

  it('invokes onError on transport error', () => {
    let err: Error | null = null
    openStream('r-3', () => {}, (e) => { err = e })
    MockEventSource.instances[0].fireError()
    expect(err).toBeInstanceOf(Error)
  })

  it('returned close() closes the EventSource', () => {
    const close = openStream('r-4', () => {}, () => {})
    close()
    expect(MockEventSource.instances[0].closed).toBe(true)
  })

  it('returned close() prevents further onEvent / onError callbacks', () => {
    const events: unknown[] = []
    let err: Error | null = null
    const close = openStream('r-5', (e) => events.push(e), (e) => { err = e })
    const es = MockEventSource.instances[0]
    close()
    es.emit({ seq: 1, type: 'x', data: {}, ts: 't' })
    es.fireError()
    expect(events).toEqual([])
    expect(err).toBeNull()
  })

  it('closes the stream on pipeline.completed and swallows the subsequent onerror', () => {
    let err: Error | null = null
    openStream('r-6', () => {}, (e) => { err = e })
    const es = MockEventSource.instances[0]
    es.emit({ seq: 9, type: 'pipeline.completed', data: {}, ts: 't' })
    expect(es.closed).toBe(true)
    es.fireError()  // simulate browser's post-graceful-close reconnect attempt
    expect(err).toBeNull()
  })

  it('closes the stream on pipeline.failed and swallows the subsequent onerror', () => {
    let err: Error | null = null
    openStream('r-7', () => {}, (e) => { err = e })
    const es = MockEventSource.instances[0]
    es.emit({ seq: 9, type: 'pipeline.failed', data: {}, ts: 't' })
    expect(es.closed).toBe(true)
    es.fireError()
    expect(err).toBeNull()
  })
})
