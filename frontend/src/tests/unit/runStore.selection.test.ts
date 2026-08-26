import { describe, it, expect, beforeEach } from 'vitest'
import { useRunStore } from '@/store/runStore'

describe('runStore selection slice', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
  })

  it('starts with no film or region selected', () => {
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBeNull()
    expect(s.selectedRegion).toBeNull()
  })

  it('pickFilm sets the film and clears region', () => {
    useRunStore.getState().pickRegion('Brazil')
    useRunStore.getState().pickFilm(42)
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBe(42)
    expect(s.selectedRegion).toBeNull()
  })

  it('pickRegion sets the region without touching film', () => {
    useRunStore.getState().pickFilm(7)
    useRunStore.getState().pickRegion('Japan')
    const s = useRunStore.getState()
    expect(s.selectedFilmId).toBe(7)
    expect(s.selectedRegion).toBe('Japan')
  })

  it('pickRegion(null) clears the region', () => {
    useRunStore.getState().pickRegion('Japan')
    useRunStore.getState().pickRegion(null)
    expect(useRunStore.getState().selectedRegion).toBeNull()
  })
})
