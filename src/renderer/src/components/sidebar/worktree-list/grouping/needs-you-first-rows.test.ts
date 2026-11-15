import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { isWorktreeCIFailing } from './group-keys'
import { IDLE_PROJECTS_GROUP_KEY } from './group-keys'
import { nextProjectTierMemory } from './project-tier-order'
import type { ProjectTierMemory } from './project-tier-order'
import type { ProjectActivityInputs } from './project-activity'
import type { WorkspaceUrgencySignal } from './project-urgency-tier'
import type { GroupHeaderRow, Row } from './row-types'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const AT_0800 = Date.UTC(2026, 10, 15, 8, 0)
const AT_0820 = AT_0800 + 20 * MIN

const NAMES = [
  'cineco-frontend',
  'cineco-prototype',
  'orca-oss',
  'koombea-website',
  'certified-received',
  'koombea-ai-workflows',
  'project-hub'
] as const
type Name = (typeof NAMES)[number]

const project = (id: string, extra: Partial<Repo> = {}): Repo => ({
  ...repo,
  id,
  path: `/tmp/${id}`,
  displayName: id,
  ...extra
})
const repoMap = new Map(NAMES.map((id) => [id, project(id)]))
// Manual order follows none of the tiers.
const REPO_ORDER = new Map(NAMES.toReversed().map((id, n) => [id, n] as [string, number]))

function wt(id: string, repoId: Name, lastActivityAt: number, extra: Partial<Worktree> = {}) {
  return {
    ...worktree,
    id,
    repoId,
    displayName: id,
    branch: `refs/heads/${id}`,
    lastActivityAt,
    ...extra
  }
}

function sidebarAt(now: number, certifiedOutputAt: number, prototypeAt: number): Worktree[] {
  return [
    wt('aerin', 'cineco-frontend', AT_0800 - 4 * MIN),
    wt('cineco-main', 'cineco-frontend', AT_0800 - DAY, { isMainWorktree: true }),
    wt('prototype-main', 'cineco-prototype', prototypeAt, { isMainWorktree: true }),
    wt('orca-main', 'orca-oss', AT_0800 - 25 * MIN, { isMainWorktree: true }),
    wt('orca-1198', 'orca-oss', AT_0800 - 40 * MIN),
    wt('hero', 'koombea-website', AT_0800 - 12 * MIN),
    wt('handover', 'certified-received', certifiedOutputAt),
    wt('timesheet', 'koombea-ai-workflows', AT_0800 - 3 * HOUR),
    wt('hub-main', 'project-hub', now - 14 * DAY, { isMainWorktree: true })
  ]
}

// orca-oss: CI failing on the delivered PR of orca-1198 (#1205).
const PR_CACHE = {
  'orca-oss::orca-1198': { data: { state: 'open', checksStatus: 'failure' } },
  'koombea-website::hero': { data: { state: 'open', checksStatus: 'pending' } },
  'koombea-ai-workflows::timesheet': { data: { state: 'merged', checksStatus: 'failure' } }
}

// Why from the cache here: WorktreeList passes buildRows no prCache under groupBy 'repo'.
const CI_FAILING = new Set(
  sidebarAt(AT_0800, 0, 0)
    .filter((w) => isWorktreeCIFailing(w, repoMap, PR_CACHE))
    .map((w) => w.id)
)

function inputs(
  now: number,
  signals: [string, WorkspaceUrgencySignal][],
  tierMemory: ProjectTierMemory = new Map()
): ProjectActivityInputs {
  return {
    now,
    currentWorktreeId: null,
    liveAgentWorktreeIds: new Set(),
    windowMs: DAY,
    urgency: {
      signalByWorktreeId: new Map(signals),
      ciFailingWorktreeIds: CI_FAILING,
      tierMemory
    }
  }
}

function build(
  worktrees: Worktree[],
  fold: ProjectActivityInputs,
  orderBy: ProjectOrderBy = 'needs-you',
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
    fold
  )
}

const repoHeaders = (rows: Row[]): GroupHeaderRow[] =>
  rows.filter((row): row is GroupHeaderRow => row.type === 'header' && row.repo !== undefined)
const activeLabels = (rows: Row[]): string[] => {
  const idleAt = rows.findIndex(
    (row) => row.type === 'header' && row.key === IDLE_PROJECTS_GROUP_KEY
  )
  return repoHeaders(idleAt === -1 ? rows : rows.slice(0, idleAt)).map((row) => row.label)
}
const header = (rows: Row[], label: string) => repoHeaders(rows).find((row) => row.label === label)

const SIGNALS_0800: [string, WorkspaceUrgencySignal][] = [
  ['aerin', 'question'],
  ['orca-main', 'working'],
  ['hero', 'working'],
  ['handover', 'working']
]

describe('isWorktreeCIFailing', () => {
  it('reads failing CI only from an open or draft PR in the live cache', () => {
    const at = (branch: string, data: object) => ({ [`repo-1::${branch}`]: { data } })
    const branch = 'feature/super-critical'
    expect(
      isWorktreeCIFailing(
        worktree,
        new Map([[repo.id, repo]]),
        at(branch, { state: 'open', checksStatus: 'failure' })
      )
    ).toBe(true)
    expect(
      isWorktreeCIFailing(
        worktree,
        new Map([[repo.id, repo]]),
        at(branch, { state: 'draft', checksStatus: 'failure' })
      )
    ).toBe(true)
    expect(
      isWorktreeCIFailing(
        worktree,
        new Map([[repo.id, repo]]),
        at(branch, { state: 'merged', checksStatus: 'failure' })
      )
    ).toBe(false)
    expect(
      isWorktreeCIFailing(
        worktree,
        new Map([[repo.id, repo]]),
        at(branch, { state: 'open', checksStatus: 'pending' })
      )
    ).toBe(false)
    expect(isWorktreeCIFailing(worktree, new Map([[repo.id, repo]]), null)).toBe(false)
  })
})

describe('Needs you first rows', () => {
  const at0800 = sidebarAt(AT_0800, AT_0800 - 30 * MIN, AT_0800 - 2 * DAY)

  it('orders the active group by tier and puts the reason on each header', () => {
    const rows = build(at0800, inputs(AT_0800, SIGNALS_0800))
    expect(activeLabels(rows)).toEqual([
      'cineco-frontend',
      'orca-oss',
      'koombea-website',
      'certified-received',
      'koombea-ai-workflows'
    ])
    expect(header(rows, 'cineco-frontend')?.urgency).toMatchObject({
      tier: 1,
      reason: { kind: 'questions', count: 1 }
    })
    // A running agent does not outrank its failing PR.
    expect(header(rows, 'orca-oss')?.urgency).toMatchObject({
      tier: 2,
      reason: { kind: 'ci-failing' }
    })
    expect(header(rows, 'koombea-website')?.urgency).toMatchObject({
      tier: 3,
      reason: { kind: 'working', count: 1 }
    })
    // A merged PR's red CI is no longer the team's to fix.
    expect(header(rows, 'koombea-ai-workflows')?.urgency).toMatchObject({ tier: 4, reason: null })
  })

  it('keeps idle projects in En reposo by age, without a tier', () => {
    const rows = build(at0800, inputs(AT_0800, SIGNALS_0800))
    expect(header(rows, 'cineco-prototype')?.urgency).toBeUndefined()
    expect(header(rows, 'project-hub')?.urgency).toBeUndefined()
    const idleAt = rows.findIndex(
      (row) => row.type === 'header' && row.key === IDLE_PROJECTS_GROUP_KEY
    )
    expect(repoHeaders(rows.slice(idleAt)).map((row) => row.label)).toEqual([
      'cineco-prototype',
      'project-hub'
    ])
  })

  it('freezes the order inside a tier and moves a project only when its tier changes (§4)', () => {
    const first = build(at0800, inputs(AT_0800, SIGNALS_0800))
    const memory = nextProjectTierMemory(first)
    const at0820 = sidebarAt(AT_0820, AT_0800 + 18 * MIN, AT_0800 + 15 * MIN)
    const second = build(
      at0820,
      inputs(AT_0820, [...SIGNALS_0800, ['prototype-main', 'account-limit']], memory)
    )
    expect(activeLabels(second)).toEqual([
      'cineco-prototype',
      'cineco-frontend',
      'orca-oss',
      'koombea-website',
      'certified-received',
      'koombea-ai-workflows'
    ])
    expect(header(second, 'cineco-prototype')?.urgency?.reason).toEqual({ kind: 'account-limit' })

    // Without the memory, certified-received's newer output would have moved it up.
    const unfrozen = build(
      at0820,
      inputs(AT_0820, [...SIGNALS_0800, ['prototype-main', 'account-limit']])
    )
    expect(activeLabels(unfrozen).indexOf('certified-received')).toBeLessThan(
      activeLabels(unfrozen).indexOf('koombea-website')
    )
  })

  it('shows the reasons under every order but sorts by tier only for needs-you', () => {
    const recent = build(at0800, inputs(AT_0800, SIGNALS_0800), 'recent')
    expect(activeLabels(recent)[0]).toBe('cineco-frontend')
    expect(activeLabels(recent)).toEqual([
      'cineco-frontend',
      'koombea-website',
      'orca-oss',
      'certified-received',
      'koombea-ai-workflows'
    ])
    expect(header(recent, 'orca-oss')?.urgency?.reason).toEqual({ kind: 'ci-failing' })
    const manual = build(at0800, inputs(AT_0800, SIGNALS_0800), 'manual')
    expect(activeLabels(manual)).toEqual([
      'koombea-ai-workflows',
      'certified-received',
      'koombea-website',
      'orca-oss',
      'cineco-frontend'
    ])
  })

  it('orders the active projects inside a Project Group by their own tiers', () => {
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
      [...repoMap].map(([id, r]) => [id, id === 'orca-oss' ? r : { ...r, projectGroupId: 'g1' }])
    )
    const rows = build(at0800, inputs(AT_0800, SIGNALS_0800), 'needs-you', [group], grouped)
    expect(repoHeaders(rows).map((row) => row.label)).toEqual([
      'cineco-frontend',
      'koombea-website',
      'certified-received',
      'koombea-ai-workflows',
      'cineco-prototype',
      'project-hub',
      'orca-oss'
    ])
  })

  it('keeps a project with a signal or failing CI active however old its activity (§4, §6)', () => {
    const fold = inputs(AT_0800, [...SIGNALS_0800, ['prototype-main', 'question']])
    const stale: ProjectActivityInputs = {
      ...fold,
      urgency: {
        ...fold.urgency!,
        ciFailingWorktreeIds: new Set([...CI_FAILING, 'hub-main'])
      }
    }
    const rows = build(at0800, stale)
    const active = activeLabels(rows)
    expect(active).toContain('cineco-prototype')
    expect(active).toContain('project-hub')
    expect(header(rows, 'cineco-prototype')?.urgency?.tier).toBe(1)
    expect(header(rows, 'project-hub')?.urgency?.tier).toBe(2)
  })
})
