import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Row } from './worktree-list/grouping/row-types'
import { addHostSectionRows } from './host-section-rows'
import { countActiveWorktrees } from './host-header-active-count'

const repo = (id: string, connectionId?: string): Repo => ({
  id,
  path: `/${id}`,
  displayName: id,
  badgeColor: '#000000',
  addedAt: 0,
  connectionId
})

const repoHeader = (project: Repo): Row => ({
  type: 'header',
  key: `repo:${project.id}`,
  label: project.displayName,
  count: 1,
  tone: 'text-foreground',
  repo: project
})

const item = (id: string, project: Repo): Row => ({
  type: 'item',
  rowKey: `repo:${project.id}:${id}`,
  sectionKey: `repo:${project.id}`,
  worktree: { id, repoId: project.id, path: `/${project.id}/${id}` } as Worktree,
  repo: project,
  depth: 0,
  groupDepth: 0,
  lineageTrail: [],
  isLastLineageChild: true,
  lineageChildCount: 0
})

describe("a host row's active count, as V30's '1 activo' (ORCA-1149)", () => {
  it("carries each host section's worktree ids", () => {
    const local = repo('local')
    const ssh = repo('ssh', 'ssh-1')

    const sectioned = addHostSectionRows({
      rows: [
        repoHeader(local),
        item('local-a', local),
        item('local-b', local),
        repoHeader(ssh),
        item('ssh-wt', ssh)
      ],
      hostOptions: [
        {
          id: 'local',
          kind: 'local',
          label: 'Local Mac',
          detail: 'This computer',
          health: 'local'
        },
        { id: 'ssh:ssh-1', kind: 'ssh', label: 'Builder', detail: 'SSH', health: 'available' }
      ],
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    expect(sectioned.filter((row) => row.type === 'host-header')).toMatchObject([
      { label: 'Local Mac', worktreeIds: ['local-a', 'local-b'] },
      { label: 'Builder', worktreeIds: ['ssh-wt'] }
    ])
  })

  it('counts agents at work and agents waiting on the user, not done or idle ones', () => {
    expect(
      countActiveWorktrees(
        new Map([
          ['a', 'working'],
          ['b', 'permission'],
          ['c', 'done'],
          ['d', 'active'],
          ['e', 'inactive']
        ] as const)
      )
    ).toBe(2)
  })
})
