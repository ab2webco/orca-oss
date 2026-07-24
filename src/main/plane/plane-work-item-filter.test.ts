import { describe, expect, it } from 'vitest'
import { filterNeedsViewer, filterPlaneWorkItems } from './plane-work-item-filter'
import type { PlaneWorkItem } from '../../shared/plane-types'

function workItem(
  id: string,
  group: string,
  overrides: Partial<PlaneWorkItem> = {}
): PlaneWorkItem {
  return {
    id,
    identifier: `ALPHA-${id}`,
    sequenceId: Number(id),
    title: `Item ${id}`,
    url: `https://example.com/${id}`,
    project: { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha' },
    state: { id: `state-${group}`, name: group, group },
    labels: [],
    assignees: [],
    updatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

const items: PlaneWorkItem[] = [
  workItem('1', 'backlog', { assignees: [{ id: 'me', displayName: 'Me' }], createdBy: 'me' }),
  workItem('2', 'unstarted', {
    assignees: [{ id: 'other', displayName: 'Other' }],
    createdBy: 'me'
  }),
  workItem('3', 'started', { createdBy: 'other' }),
  workItem('4', 'completed', { assignees: [{ id: 'me', displayName: 'Me' }], createdBy: 'other' }),
  workItem('5', 'cancelled', { createdBy: 'me' })
]

describe('filterPlaneWorkItems', () => {
  it('all -> only open state groups (backlog/unstarted/started)', () => {
    expect(filterPlaneWorkItems(items, 'all', 'me').map((item) => item.id)).toEqual(['1', '2', '3'])
  })

  it('done -> only closed state groups (completed/cancelled)', () => {
    expect(filterPlaneWorkItems(items, 'done', 'me').map((item) => item.id)).toEqual(['4', '5'])
  })

  it('done ignores the viewer id entirely', () => {
    expect(filterPlaneWorkItems(items, 'done', null).map((item) => item.id)).toEqual(['4', '5'])
  })

  it('assigned -> items whose assignees include the viewer (across any state group)', () => {
    expect(filterPlaneWorkItems(items, 'assigned', 'me').map((item) => item.id)).toEqual(['1', '4'])
  })

  it('created -> items whose createdBy equals the viewer', () => {
    expect(filterPlaneWorkItems(items, 'created', 'me').map((item) => item.id)).toEqual([
      '1',
      '2',
      '5'
    ])
  })

  it('assigned with a null viewer falls back to the open set, never empty', () => {
    expect(filterPlaneWorkItems(items, 'assigned', null).map((item) => item.id)).toEqual([
      '1',
      '2',
      '3'
    ])
  })

  it('created with a null viewer falls back to the open set, never empty', () => {
    expect(filterPlaneWorkItems(items, 'created', null).map((item) => item.id)).toEqual([
      '1',
      '2',
      '3'
    ])
  })
})

describe('filterNeedsViewer', () => {
  it('is true only for the viewer-scoped filters', () => {
    expect(filterNeedsViewer('assigned')).toBe(true)
    expect(filterNeedsViewer('created')).toBe(true)
    expect(filterNeedsViewer('all')).toBe(false)
    expect(filterNeedsViewer('done')).toBe(false)
  })
})
