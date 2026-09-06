import { describe, expect, it } from 'vitest'
import { colors } from '../theme/mobile-theme'
import type { LinearMobileIssue } from './linear-mobile-issue-read'
import {
  compareProviderTasks,
  createProviderPriorityScale,
  compareLinearIssues,
  getLinearPriorityLabel,
  getLinearPriorityRank,
  groupLinearIssues
} from './linear-mobile-issue-grouping'

// Characterizes the current mobile Linear board grouping before it is generalized to a
// provider-agnostic board (ORCA-385). No product change — this only pins today's behavior.

function issue(over: Partial<LinearMobileIssue> & { id: string }): LinearMobileIssue {
  return {
    identifier: over.id.toUpperCase(),
    title: `Issue ${over.id}`,
    url: `https://linear.app/${over.id}`,
    state: { name: 'Todo', type: 'unstarted', color: '#111111' },
    team: { id: 't1', name: 'Team One', key: 'T1' },
    labels: [],
    priority: 0,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over
  }
}

describe('getLinearPriorityLabel', () => {
  it('names the known Linear priorities and falls back to P<n>', () => {
    expect([0, 1, 2, 3, 4].map(getLinearPriorityLabel)).toEqual([
      'None',
      'Urgent',
      'High',
      'Medium',
      'Low'
    ])
    expect(getLinearPriorityLabel(7)).toBe('P7')
  })
})

describe('getLinearPriorityRank', () => {
  it('sinks "no priority" (0) below every set priority', () => {
    expect(getLinearPriorityRank(0)).toBe(5)
    expect(getLinearPriorityRank(1)).toBe(1)
    expect(getLinearPriorityRank(4)).toBe(4)
  })
})

describe('provider-neutral grouping', () => {
  it('accepts a provider-owned priority type and scale', () => {
    type Card = { id: string; priority: 'urgent' | 'none'; updatedAt: string }
    const scale = createProviderPriorityScale(
      { urgent: 'Urgent', none: 'None' },
      { urgent: 1, none: 5 },
      String,
      () => Number.POSITIVE_INFINITY
    )
    const provider = {
      identifier: (card: Card) => card.id,
      updatedAt: (card: Card) => card.updatedAt,
      priority: (card: Card) => card.priority,
      priorityLabel: scale.label,
      priorityRank: scale.rank,
      priorityColor: (priority: Card['priority']) =>
        priority === 'urgent' ? colors.statusRed : colors.accentBlue,
      status: (card: Card) => ({ key: card.id, label: card.id, color: colors.accentBlue }),
      assignee: () => null,
      team: (card: Card) => ({ key: card.id, label: card.id, color: colors.accentBlue }),
      defaultColor: colors.accentBlue
    }
    const none: Card = { id: 'ORCA-2', priority: 'none', updatedAt: '' }
    const urgent: Card = { id: 'ORCA-10', priority: 'urgent', updatedAt: '' }

    expect(compareProviderTasks(urgent, none, 'priority', provider)).toBeLessThan(0)
    expect(compareProviderTasks(none, urgent, 'identifier', provider)).toBeLessThan(0)
  })
})

describe('compareLinearIssues', () => {
  it('orders by most recently updated first', () => {
    const older = issue({ id: 'a', updatedAt: '2026-09-01T00:00:00.000Z' })
    const newer = issue({ id: 'b', updatedAt: '2026-09-03T00:00:00.000Z' })
    expect(compareLinearIssues(older, newer, 'updated')).toBeGreaterThan(0)
    expect(compareLinearIssues(newer, older, 'updated')).toBeLessThan(0)
  })

  it('orders by identifier with numeric awareness, so ORCA-2 precedes ORCA-10', () => {
    const two = issue({ id: 'x', identifier: 'ORCA-2' })
    const ten = issue({ id: 'y', identifier: 'ORCA-10' })
    expect(compareLinearIssues(two, ten, 'identifier')).toBeLessThan(0)
  })

  it('orders by priority rank, then by most recently updated on a tie', () => {
    const urgent = issue({ id: 'u', priority: 1, updatedAt: '2026-09-01T00:00:00.000Z' })
    const medium = issue({ id: 'm', priority: 3, updatedAt: '2026-09-09T00:00:00.000Z' })
    const none = issue({ id: 'n', priority: 0, updatedAt: '2026-09-09T00:00:00.000Z' })
    // Urgent (rank 1) before Medium (rank 3) before None (rank 5), despite None being newest.
    expect(compareLinearIssues(urgent, medium, 'priority')).toBeLessThan(0)
    expect(compareLinearIssues(medium, none, 'priority')).toBeLessThan(0)

    const olderUrgent = issue({ id: 'u1', priority: 1, updatedAt: '2026-09-01T00:00:00.000Z' })
    const newerUrgent = issue({ id: 'u2', priority: 1, updatedAt: '2026-09-05T00:00:00.000Z' })
    expect(compareLinearIssues(olderUrgent, newerUrgent, 'priority')).toBeGreaterThan(0)
  })
})

describe('groupLinearIssues', () => {
  it('returns a single "Issues" section for groupBy none, sorted by the order key', () => {
    const two = issue({ id: 'x', identifier: 'ORCA-2' })
    const ten = issue({ id: 'y', identifier: 'ORCA-10' })
    const sections = groupLinearIssues([ten, two], 'none', 'identifier')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ key: 'all', label: 'Issues', color: colors.accentBlue })
    expect(sections[0]!.issues.map((entry) => entry.identifier)).toEqual(['ORCA-2', 'ORCA-10'])
  })

  it('groups by status, one section per state, coloured by the state', () => {
    const todo = issue({ id: 'a', state: { name: 'Todo', type: 'unstarted', color: '#aaaaaa' } })
    const doing = issue({
      id: 'b',
      state: { name: 'In Progress', type: 'started', color: '#bbbbbb' }
    })
    const todo2 = issue({ id: 'c', state: { name: 'Todo', type: 'unstarted', color: '#aaaaaa' } })
    const sections = groupLinearIssues([todo, doing, todo2], 'status', 'updated')

    expect(sections.map((section) => section.label)).toEqual(['Todo', 'In Progress'])
    const todoSection = sections.find((section) => section.label === 'Todo')!
    expect(todoSection.key).toBe('status:Todo')
    expect(todoSection.color).toBe('#aaaaaa')
    expect(todoSection.issues.map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  it('groups by assignee and buckets the unassigned separately', () => {
    const ada = issue({ id: 'a', assignee: { id: 'u1', displayName: 'Ada' } })
    const none1 = issue({ id: 'n1' })
    const none2 = issue({ id: 'n2' })
    const sections = groupLinearIssues([ada, none1, none2], 'assignee', 'updated')

    const adaSection = sections.find((section) => section.label === 'Ada')!
    expect(adaSection.key).toBe('assignee:u1')
    expect(adaSection.color).toBe(colors.accentBlue)

    const unassigned = sections.find((section) => section.label === 'Unassigned')!
    expect(unassigned.key).toBe('assignee:unassigned')
    expect(unassigned.issues.map((entry) => entry.id)).toEqual(['n1', 'n2'])
  })

  it('groups by priority, labels via the priority map, and paints only Urgent red', () => {
    const urgent = issue({ id: 'u', priority: 1 })
    const medium = issue({ id: 'm', priority: 3 })
    const sections = groupLinearIssues([urgent, medium], 'priority', 'updated')

    const urgentSection = sections.find((section) => section.label === 'Urgent')!
    expect(urgentSection.key).toBe('priority:1')
    expect(urgentSection.color).toBe(colors.statusRed)

    const mediumSection = sections.find((section) => section.label === 'Medium')!
    expect(mediumSection.color).toBe(colors.accentBlue)
  })

  it('groups by team, keyed by team id and — a quirk — coloured by the issue state', () => {
    const one = issue({
      id: 'a',
      team: { id: 't1', name: 'Team One', key: 'T1' },
      state: { name: 'Todo', type: 'unstarted', color: '#cccccc' }
    })
    const two = issue({
      id: 'b',
      team: { id: 't2', name: 'Team Two', key: 'T2' },
      state: { name: 'Done', type: 'completed', color: '#dddddd' }
    })
    const sections = groupLinearIssues([one, two], 'team', 'updated')

    const teamOne = sections.find((section) => section.label === 'Team One')!
    expect(teamOne.key).toBe('team:t1')
    // The team section takes the colour from the issue's state, not the team.
    expect(teamOne.color).toBe('#cccccc')
  })

  it('orders issues within each section by the order key', () => {
    const older = issue({
      id: 'a',
      state: { name: 'Todo', type: 'unstarted', color: '#111111' },
      updatedAt: '2026-09-01T00:00:00.000Z'
    })
    const newer = issue({
      id: 'b',
      state: { name: 'Todo', type: 'unstarted', color: '#111111' },
      updatedAt: '2026-09-05T00:00:00.000Z'
    })
    const sections = groupLinearIssues([older, newer], 'status', 'updated')
    expect(sections[0]!.issues.map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})
