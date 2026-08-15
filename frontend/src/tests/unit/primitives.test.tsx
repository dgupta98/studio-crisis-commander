import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { SqlBlock } from '@/components/SqlBlock'
import { Popover } from '@/components/Popover'
import { SeverityChip } from '@/components/SeverityChip'

describe('Button', () => {
  it('renders + fires onClick', () => {
    const cb = vi.fn()
    render(<Button onClick={cb}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(cb).toHaveBeenCalledOnce()
  })
  it('disabled prevents click', () => {
    const cb = vi.fn()
    render(<Button onClick={cb} disabled>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(cb).not.toHaveBeenCalled()
  })
  it('variant=primary uses accent bg', () => {
    render(<Button variant="primary">P</Button>)
    expect(screen.getByRole('button').className).toContain('bg-accent')
  })
})

describe('Card', () => {
  it('renders children in card container', () => {
    render(<Card><span>x</span></Card>)
    expect(screen.getByText('x')).toBeInTheDocument()
  })
})

describe('SqlBlock', () => {
  it('renders SQL in mono block', () => {
    render(<SqlBlock sql="SELECT 1" />)
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
  })
  it('has copy button', () => {
    render(<SqlBlock sql="SELECT 1" />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })
})

describe('Popover', () => {
  it('shows content when open', () => {
    render(<Popover open trigger={<button>t</button>}><div>panel</div></Popover>)
    expect(screen.getByText('panel')).toBeInTheDocument()
  })
  it('hides content when closed', () => {
    render(<Popover open={false} trigger={<button>t</button>}><div>panel</div></Popover>)
    expect(screen.queryByText('panel')).not.toBeInTheDocument()
  })
})

describe('SeverityChip', () => {
  it('renders label with correct sev color class', () => {
    render(<SeverityChip level="critical">critical</SeverityChip>)
    expect(screen.getByText('critical').className).toContain('bg-sev-crit-bg')
  })
  it('supports replay tone', () => {
    render(<SeverityChip level="replay">REPLAY</SeverityChip>)
    expect(screen.getByText('REPLAY').className).toContain('bg-sev-replay-bg')
  })
})
