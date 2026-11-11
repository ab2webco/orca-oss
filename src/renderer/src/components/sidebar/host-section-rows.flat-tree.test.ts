import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Row } from './worktree-list/grouping/row-types'
import { addHostSectionRows } from './host-section-rows'

const repo = (id: string, connectionId?: string): Repo => ({
  id,
  path: `/${id}`,
  displayName: id,
  badgeColor: '#000000',
  addedAt: 0,
  connectionId
})

const ORG = { id: 'ab2web', name: 'Ab2Web', connectionId: null } as never

const header = (key: string, depth: number, project?: Repo): Row => ({
  type: 'header',
  key,
  label: key,
  count: 1,
  tone: 'text-foreground',
  projectGroupDepth: depth,
  ...(project ? { repo: project } : { projectGroup: ORG })
})

const item = (id: string, project: Repo, groupDepth: number): Row => ({
  type: 'item',
  rowKey: `repo:${project.id}:${id}`,
  sectionKey: `repo:${project.id}`,
  worktree: { id, repoId: project.id, path: `/${project.id}/${id}` } as Worktree,
  repo: project,
  depth: 0,
  groupDepth,
  lineageTrail: [],
  isLastLineageChild: true,
  lineageChildCount: 0
})

const HOSTS = [
  { id: 'local', kind: 'local', label: 'Local Mac', detail: 'This computer', health: 'local' },
  { id: 'ssh:m1', kind: 'ssh', label: 'm1', detail: 'SSH', health: 'available' }
] as const

describe('host sections draw orgs and projects flat, as V30 (ORCA-1149)', () => {
  it('puts an org and its project at the host level, so cards sit one step under the project', () => {
    const local = repo('netsat')
    const remote = repo('contabo', 'm1')
    const rows = addHostSectionRows({
      rows: [
        header('project-group:ab2web', 0),
        header('repo:netsat', 1, local),
        item('netsa-81', local, 1),
        header('repo:contabo', 0, remote),
        item('c-1', remote, 0)
      ],
      hostOptions: [...HOSTS],
      workspaceHostScope: 'all',
      visibleWorkspaceHostIds: ['local', 'ssh:m1'],
      defaultHostId: 'local'
    })

    const depths = rows.map((row) =>
      row.type === 'header'
        ? `${row.key}:${row.projectGroupDepth ?? 0}`
        : row.type === 'item'
          ? `${row.worktree.id}:${row.groupDepth}`
          : row.key
    )
    expect(depths).toEqual([
      'host:local',
      'project-group:ab2web:0',
      'repo:netsat:0',
      'netsa-81:0',
      'host:ssh:m1',
      'repo:contabo:0',
      'c-1:0'
    ])
  })

  it('leaves the nested tree as it is when no host section is drawn', () => {
    const local = repo('netsat')
    const rows: Row[] = [
      header('project-group:ab2web', 0),
      header('repo:netsat', 1, local),
      item('netsa-81', local, 1)
    ]

    expect(
      addHostSectionRows({
        rows,
        hostOptions: [...HOSTS],
        workspaceHostScope: 'all',
        defaultHostId: 'local',
        preferProjectGrouping: true
      })
    ).toEqual(rows)
  })
})
