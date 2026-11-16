import { describe, expect, it } from 'vitest'
import { projectHostSetupProjectionFromRepos } from '../../../../../../shared/project-host-setup-projection'
import { buildRows } from './build-rows'
import {
  addHostSectionRows,
  canDrawHostSections,
  type HostSectionRow
} from '../../host-section-rows'
import { getProjectGroupingForRepo, buildProjectGroupingIndex } from './project-grouping'
import { getRevealGroupKeysForWorktree } from './worktree-group-keys'
import { getHostScopedProjectKey } from './project-host-split'
import type { ProjectActivityInputs } from './project-activity'
import type { WorkspaceUrgencySignal } from './project-urgency-tier'
import type { GroupHeaderRow } from './row-types'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const NOW = 1_800_000_000_000
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const identity = {
  canonicalKey: 'github.com/acme/orca-oss',
  remoteName: 'origin',
  remoteUrl: 'https://github.com/acme/orca-oss.git'
}
const local: Repo = {
  ...repo,
  id: 'oss-local',
  path: '/w/orca-oss',
  displayName: 'orca-oss',
  gitRemoteIdentity: identity
}
const paired: Repo = { ...local, id: 'oss-m1', connectionId: 'm1', executionHostId: 'ssh:m1' }
const other: Repo = { ...repo, id: 'other', path: '/w/other', displayName: 'other' }

const HOSTS = [
  {
    id: 'local' as const,
    kind: 'local' as const,
    label: 'Local',
    detail: '',
    health: 'local' as const
  },
  {
    id: 'ssh:m1' as const,
    kind: 'ssh' as const,
    label: 'm1',
    detail: '',
    health: 'available' as const
  }
]

function wt(id: string, owner: Repo, ageMs: number, extra: Partial<Worktree> = {}): Worktree {
  return {
    ...worktree,
    id,
    repoId: owner.id,
    displayName: id,
    lastActivityAt: NOW - ageMs,
    ...(owner.connectionId ? { hostId: 'ssh:m1' as const } : {}),
    ...extra
  }
}

function sections(
  repos: Repo[],
  worktrees: Worktree[],
  options: {
    collapsed?: string[]
    signals?: [string, WorkspaceUrgencySignal][]
    hosts?: typeof HOSTS
  } = {}
): HostSectionRow[] {
  const hostOptions = options.hosts ?? HOSTS
  const sectionScope = { hostOptions, workspaceHostScope: 'all' as const }
  const projection = projectHostSetupProjectionFromRepos(repos)
  const fold: ProjectActivityInputs = {
    now: NOW,
    currentWorktreeId: null,
    liveAgentWorktreeIds: new Set(),
    windowMs: DAY,
    urgency: {
      signalByWorktreeId: new Map(options.signals ?? []),
      ciFailingWorktreeIds: new Set(),
      tierMemory: new Map()
    }
  }
  const collapsed = new Set(options.collapsed ?? [])
  const rows = buildRows(
    'repo',
    worktrees,
    new Map(repos.map((r) => [r.id, r])),
    null,
    collapsed,
    new Map(repos.map((r, n) => [r.id, n])),
    undefined,
    'needs-you',
    {},
    undefined,
    false,
    undefined,
    [],
    new Set(),
    new Map(),
    new Map(),
    [],
    { projects: projection.projects, projectHostSetups: projection.setups },
    [],
    undefined,
    'local',
    'single-location',
    fold,
    canDrawHostSections(sectionScope)
  )
  return addHostSectionRows({
    rows,
    ...sectionScope,
    defaultHostId: 'local',
    collapsedHostKeys: collapsed
  })
}

type Read = { host: string; headers: GroupHeaderRow[]; items: string[] }

function byHost(rows: HostSectionRow[]): Read[] {
  const read: Read[] = []
  for (const row of rows) {
    if (row.type === 'host-header') {
      read.push({ host: row.hostId, headers: [], items: [] })
    } else if (row.type === 'header') {
      read.at(-1)?.headers.push(row)
    } else if (row.type === 'item') {
      read.at(-1)?.items.push(row.worktree.id)
    }
  }
  return read
}

const projectHeader = (read: Read): GroupHeaderRow | undefined =>
  read.headers.find((header) => header.label === 'orca-oss')

describe('a project on two hosts is one section per host (ORCA-1181)', () => {
  it('is active under the host where it is active and En reposo under the other', () => {
    const [onLocal, onM1] = byHost(
      sections([local, paired], [wt('l-1', local, 4 * MINUTE), wt('m-1', paired, 3 * DAY)])
    )

    expect(projectHeader(onLocal)?.fold).toBeUndefined()
    expect(onLocal.items).toEqual(['l-1'])
    expect(onM1.headers.some((header) => header.idleProjectsGroup)).toBe(true)
    expect(projectHeader(onM1)?.fold).toMatchObject({ state: 'folded', worktreeIds: ['m-1'] })
    expect(projectHeader(onM1)?.fold?.openWorktree.id).toBe('m-1')
  })

  it("folds under each host with that host's own workspaces when idle on both", () => {
    const [onLocal, onM1] = byHost(
      sections(
        [local, paired],
        [wt('l-1', local, 2 * DAY), wt('m-1', paired, 3 * DAY), wt('m-2', paired, 4 * DAY)]
      )
    )

    expect(projectHeader(onLocal)?.fold).toMatchObject({ workspaceCount: 1, worktreeIds: ['l-1'] })
    expect(projectHeader(onM1)?.fold).toMatchObject({
      workspaceCount: 2,
      worktreeIds: ['m-1', 'm-2']
    })
  })

  it("takes the tier and its reason from that host's workspaces only", () => {
    const [onLocal, onM1] = byHost(
      sections([local, paired], [wt('l-1', local, MINUTE), wt('m-1', paired, MINUTE)], {
        signals: [['m-1', 'question']]
      })
    )

    expect(projectHeader(onLocal)?.urgency?.reason).toBeNull()
    expect(projectHeader(onM1)?.urgency?.reason).toEqual({ kind: 'questions', count: 1 })
  })

  it('collapses under one host without collapsing under the other', () => {
    const worktrees = [wt('l-1', local, MINUTE), wt('m-1', paired, MINUTE)]
    const [onLocal, onM1] = byHost(sections([local, paired], worktrees))
    const localKey = projectHeader(onLocal)!.key

    expect(localKey).not.toBe(projectHeader(onM1)!.key)
    const [collapsedLocal, openM1] = byHost(
      sections([local, paired], worktrees, { collapsed: [localKey] })
    )
    expect(collapsedLocal.items).toEqual([])
    expect(openM1.items).toEqual(['m-1'])
  })

  it('keeps the project key exactly as today when only one host has rows', () => {
    const rows = sections([local, other], [wt('l-1', local, MINUTE), wt('o-1', other, MINUTE)])
    const projection = projectHostSetupProjectionFromRepos([local, other])
    const index = buildProjectGroupingIndex({
      projects: projection.projects,
      projectHostSetups: projection.setups
    })
    const todayKey = getProjectGroupingForRepo('oss-local', new Map([[local.id, local]]), index).key

    expect(rows.some((row) => row.type === 'host-header')).toBe(false)
    const header = rows.find(
      (row): row is GroupHeaderRow => row.type === 'header' && row.label === 'orca-oss'
    )
    expect(header?.key).toBe(todayKey)
  })
})

describe('without host cards a project is not split', () => {
  it("keeps one header with today's key when the registry knows a single host", () => {
    const rows = sections([local, paired], [wt('l-1', local, MINUTE), wt('m-1', paired, MINUTE)], {
      hosts: [HOSTS[0]]
    })
    const projection = projectHostSetupProjectionFromRepos([local, paired])
    const index = buildProjectGroupingIndex({
      projects: projection.projects,
      projectHostSetups: projection.setups
    })
    const todayKey = getProjectGroupingForRepo('oss-local', new Map([[local.id, local]]), index).key

    expect(rows.some((row) => row.type === 'host-header')).toBe(false)
    const headers = rows.filter(
      (row): row is GroupHeaderRow => row.type === 'header' && row.label === 'orca-oss'
    )
    expect(headers.map((header) => header.key)).toEqual([todayKey])
  })
})

describe('revealing a workspace of a project split per host', () => {
  it("opens the section of the workspace's own host as well as the shared project key", () => {
    const projection = projectHostSetupProjectionFromRepos([local, paired])
    const grouping = { projects: projection.projects, projectHostSetups: projection.setups }
    const repoMap = new Map([local, paired].map((r) => [r.id, r]))
    const base = getProjectGroupingForRepo(
      'oss-m1',
      repoMap,
      buildProjectGroupingIndex(grouping)
    ).key

    const keys = getRevealGroupKeysForWorktree(
      'repo',
      wt('m-1', paired, MINUTE),
      repoMap,
      null,
      new Map(),
      null,
      [],
      grouping
    )

    expect(keys).toEqual(expect.arrayContaining([base, getHostScopedProjectKey(base, 'ssh:m1')]))
  })
})
