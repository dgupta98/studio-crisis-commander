import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InjectControls } from '@/panels/InjectControls'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'
import * as sseMod from '@/api/sse'

beforeEach(() => {
  useRunStore.getState().reset()
  vi.stubEnv('VITE_API_URL', 'http://localhost:8000')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('InjectControls', () => {
  it('renders picker + inject button', () => {
    render(<InjectControls />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inject/i })).toBeInTheDocument()
  })

  it('clicking Inject calls store.inject with selected crisis type', async () => {
    const post = vi.spyOn(client, 'apiPost').mockResolvedValue({ run_id: 'r-new' })
    vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    render(<InjectControls />)
    fireEvent.change(screen.getByRole('combobox'),
      { target: { value: 'competitor_release_impact' } })
    fireEvent.click(screen.getByRole('button', { name: /inject/i }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/inject-crisis',
        expect.objectContaining({ ctype: 'competitor_release_impact' })),
    )
  })

  it('disables button while a run is in flight', () => {
    useRunStore.setState({ runId: 'r-mid', streamState: 'streaming' })
    render(<InjectControls />)
    expect(screen.getByRole('button', { name: /inject/i })).toBeDisabled()
  })

  it('rapid double-click only fires one inject POST', async () => {
    const post = vi.spyOn(client, 'apiPost').mockResolvedValue({ run_id: 'r-new' })
    vi.spyOn(sseMod, 'openStream').mockReturnValue(() => {})
    render(<InjectControls />)
    const btn = screen.getByRole('button', { name: /inject/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  })
})
