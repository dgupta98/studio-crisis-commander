import { describe, it, expect } from 'vitest'
import { REGIONS, regionAbbrev, regionLabel } from '@/lib/regions'

describe('regions', () => {
  it('exports exactly 15 canonical regions', () => {
    expect(REGIONS).toHaveLength(15)
  })
  it('has stable canonical ordering', () => {
    expect(REGIONS[0]).toBe('NA')
    expect(REGIONS[REGIONS.length - 1]).toBe('Brazil')
  })
  it('abbreviates each region to 3 chars', () => {
    for (const r of REGIONS) {
      const abbrev = regionAbbrev(r)
      expect(abbrev.length).toBeLessThanOrEqual(3)
      expect(abbrev).toMatch(/^[A-Z]{2,3}$/)
    }
  })
  it('returns display label for known code', () => {
    expect(regionLabel('NA')).toBe('North America')
    expect(regionLabel('LATAM')).toBe('Latin America')
  })
  it('returns unknown codes verbatim', () => {
    expect(regionLabel('MARS')).toBe('MARS')
    expect(regionAbbrev('MARS')).toBe('MAR')
  })
})
