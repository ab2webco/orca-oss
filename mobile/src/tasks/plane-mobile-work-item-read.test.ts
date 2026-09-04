import { describe, expect, it } from 'vitest'
import {
  decodePlaneProjects,
  decodePlaneStates,
  decodePlaneStatus,
  decodePlaneWorkItems
} from './plane-mobile-work-item-read'

const workItem = {
  id: 'wi-1',
  identifier: 'ORCA-155',
  sequenceId: 155,
  title: 'Plane on mobile',
  url: 'https://plane.example/wi-1',
  project: { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
  state: { id: 's1', name: 'In Progress', group: 'started' },
  labels: [],
  priority: 'high',
  updatedAt: '2026-09-03T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z'
}

describe('plane mobile work item decode', () => {
  it('keeps the fields the list renders', () => {
    const [decoded] = decodePlaneWorkItems([workItem])
    expect(decoded?.identifier).toBe('ORCA-155')
    expect(decoded?.state.name).toBe('In Progress')
    expect(decoded?.priority).toBe('high')
  })

  it('degrades a priority the host learned later instead of dropping the row', () => {
    const [decoded] = decodePlaneWorkItems([{ ...workItem, priority: 'blocker' }])
    expect(decoded?.id).toBe('wi-1')
    expect(decoded?.priority).toBe('none')
  })

  it('keeps a row whose state group is unknown to this client', () => {
    const [decoded] = decodePlaneWorkItems([
      { ...workItem, state: { id: 's9', name: 'Triage', group: 'intake-v2' } }
    ])
    expect(decoded?.state.group).toBe('intake-v2')
    expect(decoded?.state.name).toBe('Triage')
  })

  it('keeps a row whose state object is malformed', () => {
    const [decoded] = decodePlaneWorkItems([{ ...workItem, state: 'started' }])
    expect(decoded?.id).toBe('wi-1')
    expect(decoded?.state.name).toBe('')
  })

  it('carries unknown fields through instead of stripping the row', () => {
    const [decoded] = decodePlaneWorkItems([{ ...workItem, moduleId: 'm1' }])
    expect(decoded).toMatchObject({ moduleId: 'm1' })
  })

  it('drops only the rows with no id', () => {
    expect(decodePlaneWorkItems([workItem, { ...workItem, id: '' }])).toHaveLength(1)
  })

  it('accepts both a bare array and an items envelope', () => {
    expect(decodePlaneWorkItems({ items: [workItem] })).toHaveLength(1)
    expect(() => decodePlaneWorkItems({ nope: true })).toThrow(/work items/)
  })

  it('reads status and projects defensively', () => {
    const status = decodePlaneStatus({ connected: true, workspaces: [{ id: 'w1' }], extra: 1 })
    expect(status.connected).toBe(true)
    expect(status.workspaces[0]?.id).toBe('w1')
    expect(decodePlaneProjects([{ id: 'p1', name: 'Orca Lab' }])[0]?.identifier).toBe('')
    expect(decodePlaneStates([{ id: 's1', name: 'Backlog', group: 'backlog' }])).toHaveLength(1)
  })
})
