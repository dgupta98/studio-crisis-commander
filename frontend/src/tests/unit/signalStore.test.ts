import { describe, it, expect, beforeEach } from 'vitest'
import { useSignalStore } from '../../store/signalStore'

describe('signalStore', () => {
  beforeEach(() => useSignalStore.setState({
    rates: { box_office: 0, social: 0, reviews: 0, streaming: 0 },
    history: { box_office: [], social: [], reviews: [], streaming: [] },
  }))

  it('updates and appends history', () => {
    useSignalStore.getState().pushRates({ box_office: 10, social: 20, reviews: 5, streaming: 8 })
    const s = useSignalStore.getState()
    expect(s.rates.box_office).toBe(10)
    expect(s.history.social).toEqual([20])
  })

  it('caps history at 60 points', () => {
    const s = useSignalStore.getState()
    for (let i = 0; i < 80; i++) s.pushRates({ box_office: i, social: 0, reviews: 0, streaming: 0 })
    expect(useSignalStore.getState().history.box_office.length).toBe(60)
  })
})
