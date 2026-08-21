import { create } from 'zustand'
import type { SignalFamily } from '../components/SignalChip'

type Rates = Record<SignalFamily, number>

interface SignalState {
  rates: Rates
  history: Record<SignalFamily, number[]>
  pushRates: (r: Rates) => void
}

const HISTORY_CAP = 60

export const useSignalStore = create<SignalState>((set, get) => ({
  rates: { box_office: 0, social: 0, reviews: 0, streaming: 0 },
  history: { box_office: [], social: [], reviews: [], streaming: [] },
  pushRates: (r) => {
    const cur = get().history
    const next: Record<SignalFamily, number[]> = {
      box_office: [...cur.box_office, r.box_office].slice(-HISTORY_CAP),
      social: [...cur.social, r.social].slice(-HISTORY_CAP),
      reviews: [...cur.reviews, r.reviews].slice(-HISTORY_CAP),
      streaming: [...cur.streaming, r.streaming].slice(-HISTORY_CAP),
    }
    set({ rates: r, history: next })
  },
}))
