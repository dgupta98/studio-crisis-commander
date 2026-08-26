import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MultiRegionPicker } from '@/components/MultiRegionPicker'
import { REGIONS } from '@/lib/regions'

describe('MultiRegionPicker', () => {
  it('renders existing selections as chips', () => {
    render(<MultiRegionPicker value={['Brazil', 'Japan']} onChange={() => {}} />)
    expect(screen.getByText('Brazil')).toBeInTheDocument()
    expect(screen.getByText('Japan')).toBeInTheDocument()
  })

  it('removes a region when its × is clicked', () => {
    const onChange = vi.fn()
    render(<MultiRegionPicker value={['Brazil', 'Japan']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Remove Brazil'))
    expect(onChange).toHaveBeenCalledWith(['Japan'])
  })

  it('fills all 15 when "All 15" clicked', () => {
    const onChange = vi.fn()
    render(<MultiRegionPicker value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByText('All 15'))
    expect(onChange).toHaveBeenCalledWith([...REGIONS])
  })

  it('shows a hint when empty', () => {
    render(<MultiRegionPicker value={[]} onChange={() => {}} />)
    expect(screen.getByText(/Pick at least one region/i)).toBeInTheDocument()
  })
})
