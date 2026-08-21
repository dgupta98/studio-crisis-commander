import { create } from 'zustand'

export interface CatalogFilm {
  id: number
  title: string
  poster_url: string
  signal_delta?: number
  region_hint?: string
  featured?: boolean
}

export interface CatalogShelf {
  id: string
  title: string
  films: CatalogFilm[]
}

interface CatalogState {
  shelves: CatalogShelf[]
  films: Record<number, CatalogFilm>
  region: string | null
  setShelves: (shelves: CatalogShelf[]) => void
  setRegion: (region: string | null) => void
}

export const useCatalogStore = create<CatalogState>((set) => ({
  shelves: [],
  films: {},
  region: null,
  setShelves: (shelves) => {
    const films: Record<number, CatalogFilm> = {}
    for (const s of shelves) for (const f of s.films) films[f.id] = f
    set({ shelves, films })
  },
  setRegion: (region) => set({ region }),
}))
