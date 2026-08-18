import { describe, it, expect } from 'vitest'
import { tokens } from '../../theme/tokens'

describe('signal-family tokens', () => {
  it('exposes 4 families with hex + rgb + glow', () => {
    for (const family of ['box_office', 'social', 'reviews', 'streaming'] as const) {
      const s = tokens.signal[family]
      expect(s.hex).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(s.rgb).toMatch(/^\d+,\s*\d+,\s*\d+$/)
      expect(s.glow).toMatch(/^rgba\(/)
    }
  })
})
