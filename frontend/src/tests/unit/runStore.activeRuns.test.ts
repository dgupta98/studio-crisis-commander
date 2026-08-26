import { describe, it, expect, beforeEach } from 'vitest'
import { useRunStore } from '@/store/runStore'

describe('runStore activeRuns slice', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('starts with no active runs', () => {
    const s = useRunStore.getState()
    expect(s.activeRuns).toEqual({})
    expect(s.focusedRunId).toBeNull()
  })

  it('_registerRun adds a run entry and focuses it if first', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 5, region: 'Brazil' })
    const s = useRunStore.getState()
    expect(s.activeRuns['r_1']).toBeDefined()
    expect(s.activeRuns['r_1'].filmId).toBe(5)
    expect(s.activeRuns['r_1'].region).toBe('Brazil')
    expect(s.focusedRunId).toBe('r_1')
  })

  it('_registerRun keeps focus on existing run when a second registers', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 5, region: 'Brazil' })
    useRunStore.getState()._registerRun('r_2', { filmId: 5, region: 'Japan' })
    const s = useRunStore.getState()
    expect(Object.keys(s.activeRuns).sort()).toEqual(['r_1', 'r_2'])
    expect(s.focusedRunId).toBe('r_1')
  })

  it('focusRun switches focus without dropping others', () => {
    useRunStore.getState()._registerRun('r_1', { filmId: 5, region: 'Brazil' })
    useRunStore.getState()._registerRun('r_2', { filmId: 5, region: 'Japan' })
    useRunStore.getState().focusRun('r_2')
    expect(useRunStore.getState().focusedRunId).toBe('r_2')
    expect(Object.keys(useRunStore.getState().activeRuns).sort()).toEqual(['r_1', 'r_2'])
  })
})
