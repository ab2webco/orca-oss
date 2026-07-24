import { describe, expect, it } from 'vitest'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import { filterPlaneItemsBySearch } from './plane-work-item-search-filter'

function makeItem(identifier: string, title: string): PlaneWorkItem {
  return {
    id: identifier,
    identifier,
    sequenceId: 0,
    title,
    url: '',
    project: { id: 'p', identifier: 'P', name: 'Project' },
    state: { id: 's', name: 'Todo', group: 'unstarted', color: '#000' },
    labels: [],
    updatedAt: '',
    createdAt: ''
  }
}

const items: PlaneWorkItem[] = [
  makeItem('ENG-1', 'Fix login bug'),
  makeItem('ENG-2', 'Add dashboard chart'),
  makeItem('OPS-3', 'Rotate credentials')
]

describe('filterPlaneItemsBySearch', () => {
  it('returns all items for an empty query', () => {
    expect(filterPlaneItemsBySearch(items, '')).toEqual(items)
    expect(filterPlaneItemsBySearch(items, '   ')).toEqual(items)
  })

  it('matches the identifier case-insensitively', () => {
    expect(filterPlaneItemsBySearch(items, 'eng-2')).toEqual([items[1]])
  })

  it('matches the title case-insensitively', () => {
    expect(filterPlaneItemsBySearch(items, 'LOGIN')).toEqual([items[0]])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterPlaneItemsBySearch(items, 'nonexistent')).toEqual([])
  })
})
