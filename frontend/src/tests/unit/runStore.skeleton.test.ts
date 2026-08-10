import { describe, it, expect, beforeEach } from 'vitest'
import { useRunStore } from '@/store/runStore'

describe('runStore — initial shape', () => {
  beforeEach(() => useRunStore.getState().reset())

  it('starts with everything empty/idle', () => {
    const s = useRunStore.getState()
    expect(s.runId).toBeNull()
    expect(s.events).toEqual([])
    expect(s.detection).toBeNull()
    expect(s.findings).toEqual([])
    expect(s.decision).toBeNull()
    expect(s.report).toBeNull()
    expect(s.approvalStatus).toBeNull()
    expect(s.mode).toBeNull()
    expect(s.recentDetections).toEqual([])
    expect(s.auditRows).toEqual([])
    expect(s.metrics).toEqual({})
    expect(s.latencyMs).toBeNull()
    expect(s.streamState).toBe('idle')
    expect(s.apiReachable).toBe(true)
    expect(s.panelStates.hero).toEqual({ kind: 'idle' })
    expect(s.panelStates.telemetry).toEqual({ kind: 'idle' })
    expect(s.panelStates.anomaly.kind).toBeDefined()
    expect(s.panelStates.trace).toEqual({ kind: 'idle' })
    expect(s.panelStates.recommendation).toEqual({ kind: 'idle' })
    expect(s.panelStates.approval).toEqual({ kind: 'idle' })
    expect(s.panelStates.history.kind).toBeDefined()
  })

  it('reset() restores initial state after mutation', () => {
    useRunStore.setState({ runId: 'r-1' })
    expect(useRunStore.getState().runId).toBe('r-1')
    useRunStore.getState().reset()
    expect(useRunStore.getState().runId).toBeNull()
  })

  it('exports all required actions as functions', () => {
    const s = useRunStore.getState()
    expect(typeof s.inject).toBe('function')
    expect(typeof s.connectStream).toBe('function')
    expect(typeof s.approve).toBe('function')
    expect(typeof s.deny).toBe('function')
    expect(typeof s.loadDetections).toBe('function')
    expect(typeof s.loadAudit).toBe('function')
    expect(typeof s.loadMetrics).toBe('function')
    expect(typeof s.reset).toBe('function')
  })
})
