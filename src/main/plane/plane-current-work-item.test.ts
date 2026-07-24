import { describe, expect, it } from 'vitest'
import { getPlaneCurrentWorkItemFromWorktree } from './plane-current-work-item'

describe('getPlaneCurrentWorkItemFromWorktree', () => {
  it('reads the persisted Plane link ids and scope from the worktree', () => {
    const link = getPlaneCurrentWorkItemFromWorktree({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree',
      linkedPlaneWorkItem: {
        identifier: 'PROJ-12',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        url: 'https://plane.example.com/PROJ-12'
      }
    })

    expect(link).toEqual({
      identifier: 'PROJ-12',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      url: 'https://plane.example.com/PROJ-12',
      worktreeId: 'repo::/tmp/worktree',
      worktreePath: '/tmp/worktree'
    })
  })

  it('omits an optional workspace/url that the link never carried', () => {
    const link = getPlaneCurrentWorkItemFromWorktree({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree',
      linkedPlaneWorkItem: { identifier: 'PROJ-7', projectId: 'project-9' }
    })

    expect(link).toEqual({
      identifier: 'PROJ-7',
      projectId: 'project-9',
      worktreeId: 'repo::/tmp/worktree',
      worktreePath: '/tmp/worktree'
    })
  })

  it('returns null when the worktree has no Plane link', () => {
    expect(
      getPlaneCurrentWorkItemFromWorktree({ id: 'repo::/tmp/worktree', path: '/tmp/worktree' })
    ).toBeNull()
  })

  it('returns null when the link is missing an identifier or project id', () => {
    expect(
      getPlaneCurrentWorkItemFromWorktree({
        id: 'repo::/tmp/worktree',
        path: '/tmp/worktree',
        linkedPlaneWorkItem: { identifier: '  ', projectId: 'project-1' }
      })
    ).toBeNull()
    expect(
      getPlaneCurrentWorkItemFromWorktree({
        id: 'repo::/tmp/worktree',
        path: '/tmp/worktree',
        linkedPlaneWorkItem: { identifier: 'PROJ-12', projectId: '' }
      })
    ).toBeNull()
  })
})
