import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Row } from './worktree-list/grouping/row-types'
import { addHostSectionRows, type HostSectionRow } from './host-section-rows'

function repo(id: string, connectionId?: string | null): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0,
    connectionId
  }
}

function worktree(id: string, repoId: string): Worktree {
  return {
    id,
    repoId,
    path: `/${repoId}/${id}`,
    branch: `refs/heads/${id}`,
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function header(key: string, label = key): Extract<Row, { type: 'header' }> {
  return {
    type: 'header',
    key,
    label,
    count: 1,
    tone: 'text-foreground'
  }
}

function repoHeader(project: Repo): Extract<Row, { type: 'header' }> {
  return {
    ...header(`repo:${project.id}`, project.displayName),
    repo: project
  }
}

function item(id: string, project: Repo): Extract<Row, { type: 'item' }> {
  const sectionKey = `repo:${project.id}`
  return {
    type: 'item',
    rowKey: `${sectionKey}:${id}`,
    sectionKey,
    worktree: worktree(id, project.id),
    repo: project,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: true,
    lineageChildCount: 0
  }
}

const TWO_HOSTS = [
  {
    id: 'local' as const,
    kind: 'local' as const,
    label: 'Local Mac',
    detail: 'This computer',
    health: 'local' as const
  },
  {
    id: 'ssh:ssh-1' as const,
    kind: 'ssh' as const,
    label: 'Builder',
    detail: 'SSH',
    health: 'available' as const
  }
]

function rowKey(row: HostSectionRow): string {
  return row.type === 'item' ? row.worktree.id : row.key
}

describe('addHostSectionRows across hosts (ORCA-1181)', () => {
  it('drops the host chip from rows a host header already names', () => {
    const local = repo('local')
    const ssh = repo('ssh', 'ssh-1')
    const rows = [
      repoHeader(local),
      { ...item('local-wt', local), hostContextLabel: 'Local Mac' },
      repoHeader(ssh),
      { ...item('ssh-wt', ssh), hostContextLabel: 'Builder' }
    ]

    const sectioned = addHostSectionRows({
      rows,
      hostOptions: TWO_HOSTS,
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    const items = sectioned.filter((row) => row.type === 'item')
    expect(items.map((row) => row.hostContextLabel)).toEqual([undefined, undefined])
  })

  it("files a per-host project section under the host it names, not its repo's host", () => {
    const local = repo('local')
    const ssh = repo('ssh', 'ssh-1')
    const rows: Row[] = [
      { ...header('project:oss::host:local', 'orca-oss'), repo: local, hostId: 'local' },
      item('local-1', local),
      // Why the local repo: a split section's anchor repo can sit on another host.
      { ...header('project:oss::host:ssh:ssh-1', 'orca-oss'), repo: local, hostId: 'ssh:ssh-1' },
      item('ssh-1', ssh)
    ]

    const sectioned = addHostSectionRows({
      rows,
      hostOptions: TWO_HOSTS,
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    expect(sectioned.map(rowKey)).toEqual([
      'host:local',
      'project:oss::host:local',
      'local-1',
      'host:ssh:ssh-1',
      'project:oss::host:ssh:ssh-1',
      'ssh-1'
    ])
  })

  it("gives each host its own idle group, counting only that host's idle projects", () => {
    const local = repo('local')
    const localIdle = repo('local-idle')
    const sshIdle = repo('ssh-idle', 'ssh-1')
    const idleGroup: Extract<Row, { type: 'header' }> = {
      ...header('idle-projects', 'Idle'),
      count: 2,
      idleProjectsGroup: { collapsed: false },
      hostWorktreeCounts: new Map([
        ['local', 1],
        ['ssh:ssh-1', 1]
      ]),
      hostWorktreeIds: new Map([
        ['local', []],
        ['ssh:ssh-1', []]
      ])
    }
    const rows: Row[] = [
      repoHeader(local),
      item('local-wt', local),
      idleGroup,
      repoHeader(localIdle),
      repoHeader(sshIdle)
    ]

    const sectioned = addHostSectionRows({
      rows,
      hostOptions: TWO_HOSTS,
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    expect(sectioned.map(rowKey)).toEqual([
      'host:local',
      'repo:local',
      'local-wt',
      'idle-projects',
      'repo:local-idle',
      'host:ssh:ssh-1',
      'idle-projects',
      'repo:ssh-idle'
    ])
    expect(sectioned.filter((row) => row.type === 'header' && row.idleProjectsGroup)).toMatchObject(
      [
        { count: 1, hostId: 'local' },
        { count: 1, hostId: 'ssh:ssh-1' }
      ]
    )
  })
})
