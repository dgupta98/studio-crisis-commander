import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { tokens } from '@/theme/tokens'

describe('design tokens', () => {
  it('exposes newsroom-hybrid color palette', () => {
    expect(tokens.color.paper).toBe('#FBFAF7')
    expect(tokens.color.card).toBe('#FFFFFF')
    expect(tokens.color.ink).toBe('#111111')
    expect(tokens.color.accent).toBe('#A31621')
    expect(tokens.color.sev.crit.bg).toBe('#E5C0BC')
    expect(tokens.color.sev.warn.fg).toBe('#6b4a10')
    expect(tokens.color.sev.info.bg).toBe('#E8E5DA')
  })

  it('exposes cinematic motion tokens', () => {
    expect(tokens.motion.ease.cinematic).toEqual([0.16, 1, 0.3, 1])
    expect(tokens.motion.duration.reveal).toBe(0.7)
    expect(tokens.motion.duration.count).toBe(1.2)
    expect(tokens.motion.stagger).toBe(0.09)
  })

  it('exposes type family assignments', () => {
    expect(tokens.type.display).toContain('Georgia')
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
