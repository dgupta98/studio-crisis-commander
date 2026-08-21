import { describe, it, expect, beforeEach } from 'vitest'
import { useCatalogStore } from '../../store/catalogStore'

describe('catalogStore', () => {
  beforeEach(() => useCatalogStore.setState({ shelves: [], films: {}, region: null }))

  it('sets shelves', () => {
    useCatalogStore.getState().setShelves([
      { id: 'featured', title: 'Featured', films: [{ id: 1, title: 'X', poster_url: '', featured: true }] },
    ])
    expect(useCatalogStore.getState().shelves).toHaveLength(1)
    expect(useCatalogStore.getState().films[1]).toBeTruthy()
  })

  it('sets region', () => {
    useCatalogStore.getState().setRegion('US')
    expect(useCatalogStore.getState().region).toBe('US')
  })
})
