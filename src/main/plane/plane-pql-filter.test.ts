import { describe, expect, it } from 'vitest'
import type { PlaneWorkItem } from '../../shared/plane-types'
import {
  applyPlaneQuery,
  parsePlaneQuery,
  queryNeedsViewer,
  PlaneUnsupportedQueryError
} from './plane-pql-filter'

function workItem(overrides: Partial<PlaneWorkItem> & { id: string }): PlaneWorkItem {
  return {
    identifier: overrides.id,
    sequenceId: 1,
    title: overrides.id,
    url: `https://plane.example/${overrides.id}`,
    project: { id: 'p1', identifier: 'P', name: 'Proj' },
    state: { id: 's-backlog', name: 'Backlog', group: 'backlog' },
    labels: [],
    updatedAt: '2026-01-01',
    createdAt: '2026-01-01',
    ...overrides
  } as PlaneWorkItem
}

const ITEMS: PlaneWorkItem[] = [
  workItem({ id: 'A', state: { id: 's1', name: 'Todo', group: 'unstarted' }, priority: 'high' }),
  workItem({
    id: 'B',
    state: { id: 's2', name: 'In Progress', group: 'started' },
    priority: 'urgent'
  }),
  workItem({
    id: 'C',
    state: { id: 's1', name: 'Todo', group: 'unstarted' },
    priority: 'low',
    labels: ['bug'],
    assignees: [{ id: 'u1', displayName: 'Test User', email: 'user@example.com' }]
  }),
  workItem({ id: 'D', state: { id: 's3', name: 'Done', group: 'completed' }, priority: 'none' })
]

function ids(items: PlaneWorkItem[]): string[] {
  return items.map((item) => item.id).sort()
}

describe('parsePlaneQuery', () => {
  it('parses a quoted single clause', () => {
    expect(parsePlaneQuery('state = "Todo"')).toEqual([{ field: 'state', op: '=', value: 'Todo' }])
  })

  it('parses an unquoted value and tight spacing', () => {
    expect(parsePlaneQuery('priority=urgent')).toEqual([
      { field: 'priority', op: '=', value: 'urgent' }
    ])
  })

  it('parses multiple AND clauses (case-insensitive AND)', () => {
    expect(parsePlaneQuery('state = "In Progress" and priority = high')).toEqual([
      { field: 'state', op: '=', value: 'In Progress' },
      { field: 'priority', op: '=', value: 'high' }
    ])
  })

  it('parses the != operator', () => {
    expect(parsePlaneQuery('state != Done')).toEqual([{ field: 'state', op: '!=', value: 'Done' }])
  })

  it('throws on an unsupported field instead of silently matching all', () => {
    expect(() => parsePlaneQuery('campo_inexistente = "x"')).toThrow(PlaneUnsupportedQueryError)
  })

  it('throws on free text that is not a field clause', () => {
    expect(() => parsePlaneQuery('just some words')).toThrow(PlaneUnsupportedQueryError)
  })

  it('throws on an empty query', () => {
    expect(() => parsePlaneQuery('   ')).toThrow(PlaneUnsupportedQueryError)
  })
})

describe('queryNeedsViewer', () => {
  it('is true only for assignee = me', () => {
    expect(queryNeedsViewer(parsePlaneQuery('assignee = me'))).toBe(true)
    expect(queryNeedsViewer(parsePlaneQuery('assignee = "Test User"'))).toBe(false)
    expect(queryNeedsViewer(parsePlaneQuery('state = Todo'))).toBe(false)
  })
})

describe('applyPlaneQuery', () => {
  it('filters by state name (case-insensitive)', () => {
    expect(ids(applyPlaneQuery(ITEMS, parsePlaneQuery('state = "todo"'), null))).toEqual(['A', 'C'])
  })

  it('filters by priority', () => {
    expect(ids(applyPlaneQuery(ITEMS, parsePlaneQuery('priority = urgent'), null))).toEqual(['B'])
  })

  it('ANDs clauses together', () => {
    expect(
      ids(applyPlaneQuery(ITEMS, parsePlaneQuery('state = Todo AND priority = low'), null))
    ).toEqual(['C'])
  })

  it('inverts with !=', () => {
    expect(ids(applyPlaneQuery(ITEMS, parsePlaneQuery('state != Todo'), null))).toEqual(['B', 'D'])
  })

  it('filters by label', () => {
    expect(ids(applyPlaneQuery(ITEMS, parsePlaneQuery('label = bug'), null))).toEqual(['C'])
  })

  it('filters by assignee name/email', () => {
    expect(
      ids(applyPlaneQuery(ITEMS, parsePlaneQuery('assignee = "user@example.com"'), null))
    ).toEqual(['C'])
  })

  it('resolves assignee = me against the viewer id', () => {
    expect(ids(applyPlaneQuery(ITEMS, parsePlaneQuery('assignee = me'), 'u1'))).toEqual(['C'])
  })

  it('throws for assignee = me when the viewer cannot be resolved', () => {
    expect(() => applyPlaneQuery(ITEMS, parsePlaneQuery('assignee = me'), null)).toThrow(
      PlaneUnsupportedQueryError
    )
  })

  it('returns an empty set (not everything) when nothing matches', () => {
    expect(applyPlaneQuery(ITEMS, parsePlaneQuery('state = "Nope"'), null)).toEqual([])
  })
})
