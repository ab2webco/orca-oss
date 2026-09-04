import { describe, expect, it } from 'vitest'
import {
  createPlaneTask,
  filterPlaneWorkItemsByState,
  reconcilePlaneStateSelection,
  sortPlaneWorkItems
} from './plane-mobile-task-list'
import { decodePlaneStates, decodePlaneWorkItems } from './plane-mobile-work-item-read'

function workItem(overrides: Record<string, unknown> = {}) {
  return decodePlaneWorkItems([
    {
      id: 'wi-1',
      identifier: 'ORCA-155',
      title: 'Plane on mobile',
      url: 'https://plane.example/wi-1',
      workspaceId: 'w1',
      project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
      state: { id: 's1', name: 'In Progress', group: 'started' },
      priority: 'high',
      updatedAt: '2026-09-03T00:00:00.000Z',
      ...overrides
    }
  ])[0]!
}

const states = decodePlaneStates([
  { id: 's0', name: 'Backlog', group: 'backlog', sequence: 1 },
  { id: 's1', name: 'In Progress', group: 'started', sequence: 2 }
])

describe('plane mobile task list', () => {
  it('maps a work item onto the row the list renders', () => {
    const task = createPlaneTask(workItem())
    expect(task.key).toBe('plane:w1:wi-1')
    expect(task.provider).toBe('plane')
    expect(task.title).toBe('Plane on mobile')
    expect(task.subtitle).toBe('ORCA-155 · Orca Lab')
    expect(task.status).toBe('In Progress')
    expect(task.updatedAt).toBe('2026-09-03T00:00:00.000Z')
    expect(task.source.url).toBe('https://plane.example/wi-1')
  })

  it('labels a row whose state name the host did not send', () => {
    const task = createPlaneTask(workItem({ state: { id: 's1', name: '', group: 'started' } }))
    expect(task.status).toBe('started')
  })

  it('still names an untitled row', () => {
    expect(createPlaneTask(workItem({ title: '' })).title).toBe('Untitled work item')
  })

  it('filters by state only when states are selected', () => {
    const items = [
      workItem(),
      workItem({ id: 'wi-2', state: { id: 's0', name: 'Backlog', group: 'backlog' } })
    ]
    expect(filterPlaneWorkItemsByState(items, new Set())).toHaveLength(2)
    expect(filterPlaneWorkItemsByState(items, new Set(['s0'])).map((item) => item.id)).toEqual([
      'wi-2'
    ])
  })

  it('orders by the project board sequence before recency', () => {
    // Why: the backlog row is both lower priority and older, so only the board
    // sequence can put it first.
    const started = workItem({
      id: 'wi-1',
      priority: 'urgent',
      updatedAt: '2026-09-04T00:00:00.000Z'
    })
    const backlog = workItem({
      id: 'wi-2',
      state: { id: 's0', name: 'Backlog', group: 'backlog' },
      priority: 'low',
      updatedAt: '2026-09-01T00:00:00.000Z'
    })
    expect(sortPlaneWorkItems([started, backlog], states).map((item) => item.id)).toEqual([
      'wi-2',
      'wi-1'
    ])
  })

  it('falls back to priority then recency when the board order is unknown', () => {
    const low = workItem({ id: 'low', priority: 'low', updatedAt: '2026-09-04T00:00:00.000Z' })
    const urgent = workItem({ id: 'urgent', priority: 'urgent' })
    expect(sortPlaneWorkItems([low, urgent], []).map((item) => item.id)).toEqual(['urgent', 'low'])
  })

  it('forgets a selected state the project no longer reports', () => {
    expect([...reconcilePlaneStateSelection(new Set(['s0', 'gone']), states)]).toEqual(['s0'])
  })
})
