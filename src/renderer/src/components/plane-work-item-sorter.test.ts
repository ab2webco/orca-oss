import { describe, expect, it } from 'vitest'
import type { PlaneWorkItem, PlaneWorkItemPriority } from '../../../shared/plane-types'
import {
  getPlanePriorityLabel,
  getPlanePriorityWeight,
  sortPlaneWorkItems
} from './plane-work-item-sorter'

function planeWorkItem(
  identifier: string,
  title: string,
  options: {
    priority?: PlaneWorkItemPriority
    assigneeNames?: string[]
    updatedAt?: string
  } = {}
): PlaneWorkItem {
  return {
    id: `id-${identifier}`,
    identifier,
    sequenceId: Number(identifier.split('-')[1] ?? '0'),
    workspaceSlug: 'acme',
    workspaceId: 'ws-1',
    title,
    url: `https://app.plane.so/acme/browse/${identifier}/`,
    project: { id: 'proj-1', identifier: identifier.split('-')[0], name: 'Project' },
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    assignees: options.assigneeNames?.map((name, index) => ({
      id: `user-${index}`,
      displayName: name
    })),
    priority: options.priority,
    updatedAt: options.updatedAt ?? '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('TaskPage Plane sorting functionality', () => {
  describe('getPlanePriorityWeight', () => {
    it('orders the static priority tiers from none to urgent', () => {
      expect(getPlanePriorityWeight('none')).toBeLessThan(getPlanePriorityWeight('low'))
      expect(getPlanePriorityWeight('low')).toBeLessThan(getPlanePriorityWeight('medium'))
      expect(getPlanePriorityWeight('medium')).toBeLessThan(getPlanePriorityWeight('high'))
      expect(getPlanePriorityWeight('high')).toBeLessThan(getPlanePriorityWeight('urgent'))
    })

    it('treats a missing priority as the lowest weight', () => {
      expect(getPlanePriorityWeight(undefined)).toBe(getPlanePriorityWeight('none'))
    })
  })

  describe('getPlanePriorityLabel', () => {
    it('labels every static priority tier in English', () => {
      expect(getPlanePriorityLabel('none')).toBe('No priority')
      expect(getPlanePriorityLabel('low')).toBe('Low')
      expect(getPlanePriorityLabel('medium')).toBe('Medium')
      expect(getPlanePriorityLabel('high')).toBe('High')
      expect(getPlanePriorityLabel('urgent')).toBe('Urgent')
    })

    it('falls back to "No priority" when the field is absent', () => {
      expect(getPlanePriorityLabel(undefined)).toBe('No priority')
    })
  })

  describe('work item sorting', () => {
    it('sorts by identifier numerically, ascending and descending', () => {
      const items = [
        planeWorkItem('PROJ-10', 'Item 10'),
        planeWorkItem('PROJ-2', 'Item 2'),
        planeWorkItem('PROJ-1', 'Item 1')
      ]

      const asc = sortPlaneWorkItems(items, 'identifier', 'asc')
      expect(asc.map((item) => item.identifier)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-10'])

      const desc = sortPlaneWorkItems(items, 'identifier', 'desc')
      expect(desc.map((item) => item.identifier)).toEqual(['PROJ-10', 'PROJ-2', 'PROJ-1'])
    })

    it('sorts by title alphabetically', () => {
      const items = [
        planeWorkItem('PROJ-1', 'Zebra item'),
        planeWorkItem('PROJ-2', 'Apple item'),
        planeWorkItem('PROJ-3', 'Banana item')
      ]

      const sorted = sortPlaneWorkItems(items, 'title', 'asc')

      expect(sorted.map((item) => item.title)).toEqual(['Apple item', 'Banana item', 'Zebra item'])
    })

    it('sorts by static priority weight (lowest first)', () => {
      const items = [
        planeWorkItem('PROJ-1', 'Item 1', { priority: 'low' }),
        planeWorkItem('PROJ-2', 'Item 2', { priority: 'urgent' }),
        planeWorkItem('PROJ-3', 'Item 3', { priority: 'medium' })
      ]

      const sorted = sortPlaneWorkItems(items, 'priority', 'asc')

      expect(sorted.map((item) => item.priority)).toEqual(['low', 'medium', 'urgent'])
    })

    it('sorts by first assignee alphabetically, unassigned first', () => {
      const items = [
        planeWorkItem('PROJ-1', 'Item 1', { assigneeNames: ['Zoe'] }),
        planeWorkItem('PROJ-2', 'Item 2'),
        planeWorkItem('PROJ-3', 'Item 3', { assigneeNames: ['Alice'] })
      ]

      const sorted = sortPlaneWorkItems(items, 'assignee', 'asc')

      expect(sorted.map((item) => item.assignees?.[0]?.displayName)).toEqual([
        undefined,
        'Alice',
        'Zoe'
      ])
    })

    it('sorts by updated date, newest first when descending', () => {
      const items = [
        planeWorkItem('PROJ-1', 'Item 1', { updatedAt: '2026-01-01T00:00:00.000Z' }),
        planeWorkItem('PROJ-2', 'Item 2', { updatedAt: '2026-01-03T00:00:00.000Z' }),
        planeWorkItem('PROJ-3', 'Item 3', { updatedAt: '2026-01-02T00:00:00.000Z' })
      ]

      const sorted = sortPlaneWorkItems(items, 'updated', 'desc')

      expect(sorted.map((item) => item.identifier)).toEqual(['PROJ-2', 'PROJ-3', 'PROJ-1'])
    })
  })
})
