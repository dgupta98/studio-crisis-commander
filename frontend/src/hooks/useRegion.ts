import { useEffect } from 'react'
import { useCatalogStore } from '../store/catalogStore'

const KNOWN = new Set([
  'US','GB','DE','FR','JP','KR','CN','IN','BR','MX','AU','CA','IT','ES','RU',
])

export function useRegion() {
  const region = useCatalogStore((s) => s.region)
  const setRegion = useCatalogStore((s) => s.setRegion)
  useEffect(() => {
    if (region) return
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    const code = (locale.split('-')[1] || '').toUpperCase()
    setRegion(KNOWN.has(code) ? code : 'US')
  }, [region, setRegion])
  return region
}
