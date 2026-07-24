import { describe, expect, it } from 'vitest'
import type {
  PlaneComment,
  PlaneLabel,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem
} from '../shared/plane-types'
import {
  formatPlaneLabels,
  formatPlaneList,
  formatPlaneMembers,
  formatPlaneProjectList,
  formatPlaneStateMutation,
  formatPlaneStates,
  formatPlaneWorkItem
} from './plane-format'

function workItem(overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: 'wi1',
    identifier: 'PROJ-12',
    sequenceId: 12,
    title: 'Fix login',
    url: 'https://app.plane.so/acme/browse/PROJ-12/',
    project: { id: 'p1', identifier: 'PROJ', name: 'Platform' },
    state: { id: 's0', name: 'In Progress', group: 'started' },
    labels: [],
    assignees: [],
    updatedAt: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-24T00:00:00.000Z',
    ...overrides
  }
}

describe('plane-format', () => {
  it('formats a work item with assignees, labels, and priority', () => {
    const output = formatPlaneWorkItem({
      workItem: workItem({
        assignees: [{ id: 'u1', displayName: 'Ada' }],
        labels: ['bug', 'p0'],
        priority: 'high'
      })
    })
    expect(output).toContain('PROJ-12 Fix login')
    expect(output).toContain('State: In Progress')
    expect(output).toContain('Assignees: Ada')
    expect(output).toContain('Priority: high')
    expect(output).toContain('Labels: bug, p0')
  })

  it('renders unassigned and none priority defaults', () => {
    const output = formatPlaneWorkItem({ workItem: workItem() })
    expect(output).toContain('Assignees: unassigned')
    expect(output).toContain('Priority: none')
  })

  it('appends a comment count and rows when comments are included', () => {
    const comments: PlaneComment[] = [
      {
        id: 'c1',
        body: 'Looks good\nsecond line',
        createdAt: '2026-07-24T01:00:00.000Z',
        user: { id: 'u1', displayName: 'Ada' }
      }
    ]
    const output = formatPlaneWorkItem({ workItem: workItem(), comments })
    expect(output).toContain('Comments: 1')
    expect(output).toContain('Ada (2026-07-24T01:00:00.000Z): Looks good')
    expect(output).not.toContain('second line')
  })

  it('formats an empty list and a populated list', () => {
    expect(formatPlaneList([])).toBe('No Plane work items found.')
    expect(formatPlaneList([workItem()])).toContain('PROJ-12')
  })

  it('formats projects, states, labels, and members', () => {
    const projects: PlaneProject[] = [{ id: 'p1', identifier: 'PROJ', name: 'Platform' }]
    const states: PlaneState[] = [{ id: 's1', name: 'In Review', group: 'started' }]
    const labels: PlaneLabel[] = [{ id: 'l1', name: 'bug' }]
    const members: PlaneUser[] = [{ id: 'u1', displayName: 'Ada' }]
    expect(formatPlaneProjectList(projects)).toContain('Platform')
    expect(formatPlaneStates(states)).toContain('In Review')
    expect(formatPlaneStates(states)).toContain('started')
    expect(formatPlaneLabels(labels)).toContain('bug')
    expect(formatPlaneMembers(members)).toContain('Ada')
  })

  it('reports empty collections with stable copy', () => {
    expect(formatPlaneProjectList([])).toBe('No Plane projects found.')
    expect(formatPlaneStates([])).toBe('No Plane states found.')
    expect(formatPlaneLabels([])).toBe('No Plane labels found.')
    expect(formatPlaneMembers([])).toBe('No Plane members found.')
  })

  it('formats a state mutation echo', () => {
    expect(formatPlaneStateMutation({ id: 's1', name: 'In Review', group: 'started' })).toBe(
      'Saved column In Review (started) s1.'
    )
  })
})
