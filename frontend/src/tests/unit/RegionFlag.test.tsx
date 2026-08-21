import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RegionFlag } from '../../components/RegionFlag'

describe('RegionFlag', () => {
  it('renders known region emoji', () => {
    render(<RegionFlag region="US" />)
    expect(screen.getByLabelText('US')).toBeInTheDocument()
  })
  it('renders code when unknown', () => {
    render(<RegionFlag region="ZZ" />)
    expect(screen.getByText('ZZ')).toBeInTheDocument()
  })
})
