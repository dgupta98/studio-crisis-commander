import { useEffect } from 'react'
import { useSignalStore } from '../store/signalStore'

const BASE = (): string => {
  const url = import.meta.env.VITE_API_URL
  if (!url) throw new Error('VITE_API_URL is not set')
  return url.replace(/\/$/, '')
}

export function useIntakeRates(): void {
  useEffect(() => {
    const es = new EventSource(`${BASE()}/intake/rates`)
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        useSignalStore.getState().pushRates({
          box_office: Number(payload.box_office ?? 0),
          social:     Number(payload.social ?? 0),
          reviews:    Number(payload.reviews ?? 0),
          streaming:  Number(payload.streaming ?? 0),
        })
      } catch {
        /* ignore malformed */
      }
    }
    return () => {
      es.onmessage = null
      es.close()
    }
  }, [])
}
