import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { getCyclableWorktreeIds } from '../../worktree-keyboard-cycle'
import { addHostSectionRows } from '../../host-section-rows'
import { IDLE_PROJECTS_GROUP_KEY, getIdleProjectOpenKey } from './group-keys'
import type { ProjectActivityInputs } from './project-activity'
import type { GroupHeaderRow, Row } from './row-types'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function project(id: string, extra: Partial<Repo> = {}): Repo {
  return { ...repo, id, path: `/tmp/${id}`, displayName: id, ...extra }
}
const repos = new Map(
  [
    project('cineco'),
    project('koombea'),
    project('crp'),
    project('hub'),
    project('fe-ai'),
    project('landing', { kind: 'folder' })
  ].map((r) => [r.id, r])
)
// Manual order puts the idle projects in an order their ages do not follow.
const REPO_ORDER = new Map(
  ['hub', 'cineco', 'landing', 'crp', 'koombea', 'fe-ai'].map((id, n) => [id, n])
)

function wt(id: string, repoId: string, lastActivityAt: number, extra: Partial<Worktree> = {}) {
  return { ...worktree, id, repoId, displayName: id, lastActivityAt, ...extra }
}

const all = [
  wt('cineco-main', 'cineco', NOW - 4 * 60_000, { isMainWorktree: true }),
  wt('koombea-main', 'koombea', NOW - 5 * HOUR, { isMainWorktree: true }),
  wt('hub-main', 'hub', NOW - 21 * DAY, { isMainWorktree: true }),
  wt('hub-spike', 'hub', NOW - 14 * DAY),
  wt('crp-main', 'crp', NOW - 6 * DAY, { isMainWorktree: true }),
  wt('fe-main', 'fe-ai', NOW - 7 * DAY, { isMainWorktree: true }),
  wt('landing-main', 'landing', 0, { isMainWorktree: true })
]

const inputs: ProjectActivityInputs = {
  now: NOW,
  currentWorktreeId: null,
  liveAgentWorktreeIds: new Set(),
  windowMs: DAY
}

function build(
  args: {
    worktrees?: Worktree[]
    collapsed?: string[]
    fold?: ProjectActivityInputs | null
    orderBy?: ProjectOrderBy
  } = {}
): Row[] {
  return buildRows(
    'repo',
    args.worktrees ?? all,
    repos,
    null,
    new Set(args.collapsed ?? []),
    REPO_ORDER,
    undefined,
    args.orderBy ?? 'manual',
    {},
    undefined,
    false,
    undefined,
    [],
    new Set(),
    new Map(),
    new Map(),
    [],
    undefined,
    [],
    undefined,
    'local',
    'single-location',
    args.fold === null ? undefined : (args.fold ?? inputs)
  )
}

function shape(rows: Row[]): string[] {
  return rows.map((row) => {
    if (row.type === 'header') {
      return row.idleProjectsGroup ? `[idle ${row.count}]` : row.label
    }
    return row.type === 'item' ? `  ${row.worktree.id}` : row.type
  })
}

function idleHeader(rows: Row[]): GroupHeaderRow | undefined {
  return rows.find((row): row is GroupHeaderRow => row.type === 'header' && !!row.idleProjectsGroup)
}

function header(rows: Row[], label: string): GroupHeaderRow {
  const row = rows.find((r): r is GroupHeaderRow => r.type === 'header' && r.label === label)
  if (!row) {
    throw new Error(`no header ${label}`)
  }
  return row
}

describe('buildRows idle projects group', () => {
  it('lists active projects first in their order, then the idle group by age, newest first', () => {
    expect(shape(build())).toEqual([
      'cineco',
      '  cineco-main',
      'koombea',
      '  koombea-main',
      '[idle 4]',
      'crp',
      'fe-ai',
      'hub',
      'landing'
    ])
  })

  it('keeps the idle group by age whatever the sort mode', () => {
    const idle = shape(build({ orderBy: 'recent' })).slice(4)
    expect(idle).toEqual(['[idle 4]', 'crp', 'fe-ai', 'hub', 'landing'])
  })

  it('collapses under its own key, keeping its count and the hidden workspace ids', () => {
    expect(IDLE_PROJECTS_GROUP_KEY).toBe('idle-projects')
    const rows = build({ collapsed: [IDLE_PROJECTS_GROUP_KEY] })
    expect(idleHeader(rows)?.idleProjectsGroup).toEqual({ collapsed: true })
    expect(idleHeader(build())?.idleProjectsGroup).toEqual({ collapsed: false })
    expect(shape(rows)).toEqual([
      'cineco',
      '  cineco-main',
      'koombea',
      '  koombea-main',
      '[idle 4]'
    ])
    expect([...(idleHeader(rows)?.worktreeIds ?? [])].sort()).toEqual([
      'crp-main',
      'fe-main',
      'hub-main',
      'hub-spike',
      'landing-main'
    ])
    // Why: expanded, the project rows below carry their own counts for the host badge.
    expect(idleHeader(build())?.worktreeIds).toEqual([])
  })

  it('counts idle projects per host for host sections', () => {
    expect(idleHeader(build())?.hostWorktreeCounts?.get('local')).toBe(4)
  })

  it('draws no idle group when every project is active, or without fold inputs', () => {
    const recent = all.map((w) => ({ ...w, lastActivityAt: NOW - 1000 }))
    expect(idleHeader(build({ worktrees: recent }))).toBeUndefined()
    expect(idleHeader(build({ fold: null }))).toBeUndefined()
  })

  it('moves a project between the groups when the window changes', () => {
    const week = shape(build({ fold: { ...inputs, windowMs: 7 * DAY } }))
    expect(week.indexOf('crp')).toBeLessThan(week.indexOf('[idle 3]'))
    expect(week).toContain('[idle 3]')
  })

  it('gives each project header the age of its most recent workspace, and none without one', () => {
    const rows = build()
    expect(header(rows, 'hub').lastActivityAt).toBe(NOW - 14 * DAY)
    expect(header(rows, 'cineco').lastActivityAt).toBe(NOW - 4 * 60_000)
    expect(header(rows, 'landing').lastActivityAt).toBeUndefined()
  })

  it('keeps a collapsed group out of arrow cycling, and an opened idle project after the active ones', () => {
    const openHub = getIdleProjectOpenKey('repo:hub')
    expect(getCyclableWorktreeIds(build({ collapsed: [openHub] }), 'single-location')).toEqual([
      'cineco-main',
      'koombea-main',
      'hub-main',
      'hub-spike'
    ])
    expect(
      getCyclableWorktreeIds(
        build({ collapsed: [openHub, IDLE_PROJECTS_GROUP_KEY] }),
        'single-location'
      )
    ).toEqual(['cineco-main', 'koombea-main'])
  })

  it('splits inside each host: every host lists its own idle group with its own count', () => {
    const m1Repo = project('m1-old', { connectionId: 'm1' })
    const withHost = new Map([...repos, [m1Repo.id, m1Repo]])
    const rows = buildRows(
      'repo',
      [...all, wt('m1-main', 'm1-old', NOW - 9 * DAY, { isMainWorktree: true })],
      withHost,
      null,
      new Set(),
      REPO_ORDER,
      undefined,
      'manual',
      {},
      undefined,
      false,
      undefined,
      [],
      new Set(),
      new Map(),
      new Map(),
      [],
      undefined,
      [],
      undefined,
      'local',
      'single-location',
      inputs
    )
    const sectioned = addHostSectionRows({
      rows,
      hostOptions: [
        { id: 'local', kind: 'local', label: 'Mac', detail: 'This computer', health: 'local' },
        { id: 'ssh:m1', kind: 'ssh', label: 'm1', detail: 'SSH', health: 'available' }
      ],
      workspaceHostScope: 'all',
      visibleWorkspaceHostIds: ['local', 'ssh:m1'],
      defaultHostId: 'local'
    })
    expect(
      sectioned.map((row) =>
        row.type === 'host-header'
          ? `# ${row.hostId}`
          : row.type === 'header'
            ? row.idleProjectsGroup
              ? `[idle ${row.count}]`
              : row.label
            : `  ${row.type === 'item' ? row.worktree.id : row.type}`
      )
    ).toEqual([
      '# local',
      'cineco',
      '  cineco-main',
      'koombea',
      '  koombea-main',
      '[idle 4]',
      'crp',
      'fe-ai',
      'hub',
      'landing',
      '# ssh:m1',
      '[idle 1]',
      'm1-old'
    ])
  })
})
