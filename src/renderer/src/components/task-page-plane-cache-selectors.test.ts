import { describe, expect, it } from 'vitest'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import { findTaskPagePlaneWorkItem } from './task-page-plane-cache-selectors'

function planeWorkItem(identifier: string, title: string, workspaceId: string): PlaneWorkItem {
  return {
    id: `${workspaceId}:${identifier}`,
    identifier,
    sequenceId: 1,
    workspaceSlug: workspaceId,
    workspaceId,
    title,
    url: `https://app.plane.so/${workspaceId}/browse/${identifier}/`,
    project: { id: 'proj-1', identifier: identifier.split('-')[0], name: 'Project' },
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('findTaskPagePlaneWorkItem', () => {
  it('finds a work item cached by identifier in the single-item cache', () => {
    const found = findTaskPagePlaneWorkItem(
      {
        'ws-1::item::id-1': {
          data: planeWorkItem('PROJ-1', 'Cached item', 'ws-1'),
          fetchedAt: Date.now()
        }
      },
      {},
      {},
      'PROJ-1',
      { workspaceId: 'ws-1' }
    )

    expect(found?.title).toBe('Cached item')
  })

  it('keeps same-identifier Plane work items separated by workspace', () => {
    const found = findTaskPagePlaneWorkItem(
      {},
      {
        'ws-1::search::all::foo': {
          data: [planeWorkItem('PROJ-1', 'Workspace one item', 'ws-1')],
          fetchedAt: Date.now()
        },
        'ws-2::search::all::foo': {
          data: [planeWorkItem('PROJ-1', 'Workspace two item', 'ws-2')],
          fetchedAt: Date.now()
        }
      },
      {},
      'PROJ-1',
      { workspaceId: 'ws-2' }
    )

    expect(found?.title).toBe('Workspace two item')
  })

  it('falls back to the list cache when the item and search caches miss', () => {
    const found = findTaskPagePlaneWorkItem(
      {},
      {},
      {
        'ws-1::workItems::assigned::': {
          data: [planeWorkItem('PROJ-9', 'Listed item', 'ws-1')],
          fetchedAt: Date.now()
        }
      },
      'PROJ-9',
      { workspaceId: 'ws-1' }
    )

    expect(found?.title).toBe('Listed item')
  })

  it('returns null when identifier is missing or not found', () => {
    expect(findTaskPagePlaneWorkItem({}, {}, {}, null)).toBeNull()
    expect(findTaskPagePlaneWorkItem({}, {}, {}, 'PROJ-404')).toBeNull()
  })
})
