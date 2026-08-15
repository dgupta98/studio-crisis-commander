import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApprovalGate } from '@/panels/ApprovalGate'
import { useRunStore } from '@/store/runStore'
import * as client from '@/api/client'

const DEC = {
  decision_id: 'd-42', investigation_id: 'i-1', actions: [] as never,
  status: 'pending_approval' as const, threshold_usd: 0, created_at: 't', latency_ms: 0,
}

beforeEach(() => useRunStore.getState().reset())
afterEach(() => { vi.restoreAllMocks() })

describe('ApprovalGate', () => {
  it('idle — nothing to approve', () => {
    render(<ApprovalGate />)
    expect(screen.getByText(/nothing to approve|idle/i)).toBeInTheDocument()
  })

  it('with pending decision — shows Approve + Deny buttons', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming', decision: DEC as never,
                            approvalStatus: 'pending_approval' })
    useRunStore.getState()._recomputePanels()
    render(<ApprovalGate />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
  })

  it('clicking Approve calls approve action', async () => {
    const spy = vi.spyOn(client, 'apiPost').mockResolvedValue({ approval_status: 'approved' })
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming', decision: DEC as never,
                            approvalStatus: 'pending_approval' })
    useRunStore.getState()._recomputePanels()
    render(<ApprovalGate />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/approve/d-42', expect.anything()),
    )
  })

  it('approvalStatus=approved → shows approved chip, hides buttons', () => {
    useRunStore.setState({ runId: 'r-1', streamState: 'streaming', decision: DEC as never,
                            approvalStatus: 'approved' })
    useRunStore.getState()._recomputePanels()
    render(<ApprovalGate />)
    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
