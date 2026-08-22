import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { tokens } from '@/theme/tokens'

describe('design tokens', () => {
  it('exposes dark cinema color palette', () => {
    expect(tokens.color.paper).toBe('#08080c')
    expect(tokens.color.card).toBe('#13131a')
    expect(tokens.color.ink).toBe('#f5f2ea')
    expect(tokens.color.accent).toBe('#d4324a')
    expect(tokens.color.sev.crit.bg).toBe('#3a1a1a')
    expect(tokens.color.sev.warn.fg).toBe('#f0d9a0')
    expect(tokens.color.sev.info.bg).toBe('#1e1e28')
  })

  it('exposes cinematic motion tokens', () => {
    expect(tokens.motion.ease.cinematic).toEqual([0.16, 1, 0.3, 1])
    expect(tokens.motion.duration.reveal).toBe(0.7)
    expect(tokens.motion.duration.count).toBe(1.2)
    expect(tokens.motion.stagger).toBe(0.09)
  })

  it('exposes type family assignments', () => {
    expect(tokens.type.display).toContain('Inter')
    expect(tokens.type.body).toContain('Inter')
    expect(tokens.type.mono).toContain('JetBrains Mono')
  })

  it('Tailwind theme includes accent color as bg-accent class', () => {
    render(<div data-testid="probe" className="bg-accent text-paper" />)
    const el = screen.getByTestId('probe')
    expect(el.className).toContain('bg-accent')
    expect(el.className).toContain('text-paper')
  })
})
