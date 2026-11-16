/**
 * ORCA-1216 §5: the sort menu's four orders reorder the active group only; En reposo stays by
 * age and the activity-window split holds under every one of them.
 */
import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { IDLE_PROJECTS_GROUP_KEY } from './group-keys'
import type { ProjectActivityInputs } from './project-activity'
import type { OrderedGroupEntry } from './project-grouping'
import type { GroupHeaderRow, Row } from './row-types'
import { sortProjectEntries } from './section-order'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const NOW = Date.UTC(2026, 10, 15, 8, 0)

const NAMES = ['alpha', 'Bravo', 'Charlie', 'delta', 'echo', 'Foxtrot', 'golf'] as const
type Name = (typeof NAMES)[number]
const project = (id: Name, extra: Partial<Repo> = {}): Repo => ({
  ...repo,
  id,
  path: `/tmp/${id}`,
  displayName: id,
  ...extra
})
const repoMap = new Map(NAMES.map((id) => [id, project(id)] as [string, Repo]))
// Manual order matches neither the names, the activity nor the tiers.
const REPO_ORDER = new Map(
  ['golf', 'delta', 'alpha', 'echo', 'Charlie', 'Foxtrot', 'Bravo'].map(
    (id, n) => [id, n] as [string, number]
  )
)

const wt = (id: string, repoId: Name, ageMs: number): Worktree => ({
  ...worktree,
  id,
  repoId,
  displayName: id,
  branch: `refs/heads/${id}`,
  isMainWorktree: true,
  lastActivityAt: NOW - ageMs
})

const worktrees = [
  wt('alpha-main', 'alpha', 30 * MIN),
  wt('bravo-main', 'Bravo', 10 * MIN),
  wt('charlie-main', 'Charlie', 5 * MIN),
  wt('delta-main', 'delta', 20 * MIN),
  // Idle: their age order (Foxtrot, echo, golf) is neither A–Z nor manual.
  wt('echo-main', 'echo', 3 * DAY),
  wt('foxtrot-main', 'Foxtrot', 2 * DAY),
  wt('golf-main', 'golf', 10 * DAY)
]

const fold: ProjectActivityInputs = {
  now: NOW,
  currentWorktreeId: null,
  liveAgentWorktreeIds: new Set(),
  windowMs: DAY,
  urgency: {
    signalByWorktreeId: new Map([
      ['bravo-main', 'question'],
      ['charlie-main', 'working']
    ]),
    ciFailingWorktreeIds: new Set(),
    tierMemory: new Map()
  }
}

function build(
  orderBy: ProjectOrderBy,
  projectGroups: ProjectGroup[] = [],
  repos: Map<string, Repo> = repoMap
): Row[] {
  return buildRows(
    'repo',
    worktrees,
    repos,
    null,
    new Set(),
    REPO_ORDER,
    undefined,
    orderBy,
    {},
    undefined,
    false,
    undefined,
    projectGroups,
    new Set(),
    new Map(),
    new Map(),
    [],
    undefined,
    [],
    undefined,
    'local',
    'single-location',
    { ...fold, urgency: { ...fold.urgency!, tierMemory: new Map() } }
  )
}

const headerLabels = (rows: Row[]): string[] =>
  rows
    .filter((row): row is GroupHeaderRow => row.type === 'header')
    .map((row) => (row.key === IDLE_PROJECTS_GROUP_KEY ? '[idle]' : row.label))

const split = (rows: Row[]): { active: string[]; idle: string[] } => {
  const labels = headerLabels(rows)
  const at = labels.indexOf('[idle]')
  return { active: labels.slice(0, at), idle: labels.slice(at + 1) }
}

const EXPECTED_ACTIVE: Record<ProjectOrderBy, string[]> = {
  'needs-you': ['Bravo', 'Charlie', 'delta', 'alpha'],
  recent: ['Charlie', 'Bravo', 'delta', 'alpha'],
  name: ['alpha', 'Bravo', 'Charlie', 'delta'],
  manual: ['delta', 'alpha', 'Charlie', 'Bravo']
}

describe('project order options on the active group', () => {
  it.each(Object.entries(EXPECTED_ACTIVE) as [ProjectOrderBy, string[]][])(
    "orders active projects by '%s' and keeps En reposo by age with the same split",
    (orderBy, expected) => {
      expect(split(build(orderBy))).toEqual({
        active: expected,
        idle: ['Foxtrot', 'echo', 'golf']
      })
    }
  )

  it('gives each option a distinct active order, so a fallback to another one would show', () => {
    const orders = Object.values(EXPECTED_ACTIVE).map((order) => order.join())
    expect(new Set(orders).size).toBe(4)
  })

  it('orders by name inside a Project Group too', () => {
    const group: ProjectGroup = {
      id: 'g1',
      name: 'Clients',
      parentPath: null,
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 0,
      updatedAt: 0
    }
    const grouped = new Map(
      [...repoMap].map(([id, r]) => [id, id === 'Bravo' ? r : { ...r, projectGroupId: 'g1' }])
    )
    expect(headerLabels(build('name', [group], grouped))).toEqual([
      'Clients',
      'alpha',
      'Charlie',
      'delta',
      'echo',
      'Foxtrot',
      'golf',
      'Bravo'
    ])
  })
})

describe('sortProjectEntries by name', () => {
  const entry = (key: string, label: string): OrderedGroupEntry => [
    key,
    { label, items: [], repoIds: new Set([key]) }
  ]

  it('ignores case and breaks a tie on the manual order', () => {
    const order = new Map([
      ['b', 0],
      ['a', 1],
      ['c', 2]
    ])
    const sorted = sortProjectEntries(
      [entry('c', 'zulu'), entry('a', 'Same'), entry('b', 'same'), entry('d', 'Mike')],
      'name',
      order
    )
    expect(sorted.map(([key]) => key)).toEqual(['d', 'b', 'a', 'c'])
  })
})
