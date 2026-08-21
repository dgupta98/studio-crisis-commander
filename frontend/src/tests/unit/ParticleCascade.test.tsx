import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ParticleCascade } from '../../landing/ParticleCascade'

describe('ParticleCascade', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: () => {}, removeEventListener: () => {},
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a canvas element', () => {
    const { container } = render(<ParticleCascade />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('renders static fallback when reduced-motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    })))
    const { container } = render(<ParticleCascade />)
    expect(container.querySelector('[data-fallback="reduced-motion"]')).not.toBeNull()
  })
})
