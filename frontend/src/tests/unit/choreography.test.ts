import { describe, it, expect } from 'vitest'
import {
  heroReveal, panelReveal, traceRowEnter, listStagger, countUpTransition,
} from '@/motion/choreography'

describe('choreography variants', () => {
  it('heroReveal has hidden + visible states with cinematic ease', () => {
    expect((heroReveal.hidden as any).opacity).toBe(0)
    expect((heroReveal.visible as any).opacity).toBe(1)
    expect((heroReveal.visible as any).transition?.ease).toEqual([0.16, 1, 0.3, 1])
  })

  it('panelReveal duration matches token.reveal', () => {
    expect((panelReveal.visible as any).transition?.duration).toBe(0.7)
  })

  it('listStagger sets staggerChildren to 0.09', () => {
    expect((listStagger.visible as any).transition?.staggerChildren).toBe(0.09)
  })

  it('traceRowEnter has translateY + blur cleanup', () => {
    expect((traceRowEnter.hidden as any).y).toBe(12)
    expect((traceRowEnter.visible as any).y).toBe(0)
    expect((traceRowEnter.hidden as any).filter).toContain('blur(4px)')
    expect((traceRowEnter.visible as any).filter).toBe('blur(0px)')
  })

  it('countUpTransition uses token.count', () => {
    // cast needed: Transition is a union and duration is not on all branches
    expect((countUpTransition as any).duration).toBe(1.2)
  })
})
