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

  // ORCA-139: without a workspace header a two-workspace answer is
  // indistinguishable from a one-workspace answer.
  it('groups the project list under a workspace header when 2+ workspaces answer', () => {
    const projects: PlaneProject[] = [
      { id: 'p1', identifier: 'ACME', name: 'Acme Web', workspaceSlug: 'acme', workspaceId: 'w-a' },
      { id: 'p2', identifier: 'BETA', name: 'Beta App', workspaceSlug: 'beta', workspaceId: 'w-b' },
      { id: 'p3', identifier: 'BETA2', name: 'Beta Ops', workspaceSlug: 'beta', workspaceId: 'w-b' }
    ]

    const output = formatPlaneProjectList(projects)

    expect(output).toContain('Workspace acme (1)')
    expect(output).toContain('Workspace beta (2)')
    expect(output.indexOf('Workspace acme')).toBeLessThan(output.indexOf('Workspace beta'))
    expect(output).toContain('  ACME')
  })

  it('leaves a single-workspace project list ungrouped', () => {
    const projects: PlaneProject[] = [
      { id: 'p1', identifier: 'ACME', name: 'Acme Web', workspaceSlug: 'acme', workspaceId: 'w-a' },
      { id: 'p2', identifier: 'ACME2', name: 'Acme Ops', workspaceSlug: 'acme', workspaceId: 'w-a' }
    ]

    const output = formatPlaneProjectList(projects)

    expect(output).not.toContain('Workspace')
    expect(output.split('\n')).toHaveLength(2)
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

  it('shows the schedule and estimate when the item has them', () => {
    const output = formatPlaneWorkItem({
      workItem: workItem({ startDate: '2026-07-01', targetDate: '2026-07-15', estimatePoint: '5' })
    })

    expect(output).toContain('Start: 2026-07-01')
    expect(output).toContain('Target: 2026-07-15')
    expect(output).toContain('Estimate: 5')
  })

  it('omits the schedule lines for an unplanned item', () => {
    // Why omit rather than print "none": every unscheduled item would otherwise
    // carry three noise lines and bury the ones that are actually planned.
    const output = formatPlaneWorkItem({ workItem: workItem() })

    expect(output).not.toContain('Start:')
    expect(output).not.toContain('Target:')
    expect(output).not.toContain('Estimate:')
  })
})
