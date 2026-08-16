/**
 * openStream — opens an EventSource at /stream/investigation/{runId},
 * parses each `data:` payload as JSON, and dispatches to onEvent.
 *
 * The server (Layer 4 §6) replays the full event log to late/reconnecting
 * subscribers. The consumer (runStore) dedupes by event.seq. We do not
 * track lastEventId on the client.
 *
 * Called only by store.connectStream — never from a panel directly.
 */

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

export function openStream(
  runId: string,
  onEvent: (payload: unknown) => void,
  onError: (err: Error) => void,
): () => void {
  const url = `${BASE()}/stream/investigation/${runId}`
  const es = new EventSource(url)
  // Native EventSource fires onerror on ANY close, including graceful
  // server-initiated end-of-stream (readyState reverts to CONNECTING for
  // auto-reconnect). Close ourselves on terminal events so onerror stays
  // reserved for genuine transport failures.
  let terminated = false
  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data)
      onEvent(parsed)
      const t = (parsed as { type?: string })?.type
      if (t === 'pipeline.completed' || t === 'pipeline.failed') {
        terminated = true
        es.close()
      }
    } catch (e) {
      onError(new Error(`SSE parse: ${(e as Error).message}`))
    }
  }
  es.onerror = () => {
    if (terminated) return
    onError(new Error('stream error — awaiting reconnect'))
  }
  return () => {
    es.onmessage = null
    es.onerror = null
    es.close()
  }
}
