import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PlaneWorkItem } from '../../shared/plane-types'
import type { LinkedPlaneWorkItem } from '../../shared/types'
import type * as PlaneWorkItemsModule from '../plane/work-items'

const { getWorkItemMock } = vi.hoisted(() => ({ getWorkItemMock: vi.fn() }))

vi.mock('../plane/work-items', async (importActual) => ({
  ...(await importActual<typeof PlaneWorkItemsModule>()),
  getWorkItem: getWorkItemMock
}))

import { OrcaRuntimeService } from './orca-runtime'

type ResolverInternals = {
  resolveWorktreeForContainedPath: (
    cwd: string
  ) => Promise<{
    id: string
    path: string
    linkedPlaneWorkItem?: LinkedPlaneWorkItem | null
  } | null>
}

function createRuntime(): OrcaRuntimeService {
  const store = {} as unknown as NonNullable<ConstructorParameters<typeof OrcaRuntimeService>[0]>
  return new OrcaRuntimeService(store)
}

function planeWorkItem(): PlaneWorkItem {
  return {
    id: 'wi1',
    identifier: 'PROJ-12',
    sequenceId: 12,
    title: 'Fix login',
    url: 'https://plane.example.com/PROJ-12',
    project: { id: 'project-1', identifier: 'PROJ', name: 'Platform' },
    state: { id: 's0', name: 'Todo', group: 'unstarted' },
    labels: [],
    assignees: [],
    updatedAt: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-24T00:00:00.000Z'
  }
}

describe('planeResolveCurrentWorkItem', () => {
  beforeEach(() => {
    getWorkItemMock.mockReset()
  })

  it('resolves the worktree link ids and fetches the work item', async () => {
    const runtime = createRuntime()
    ;(runtime as unknown as ResolverInternals).resolveWorktreeForContainedPath = async () => ({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree',
      linkedPlaneWorkItem: {
        identifier: 'PROJ-12',
        projectId: 'project-1',
        workspaceId: 'workspace-1'
      }
    })
    const item = planeWorkItem()
    getWorkItemMock.mockResolvedValue(item)

    const result = await runtime.planeResolveCurrentWorkItem({
      cwd: '/tmp/worktree',
      remote: false
    })

    expect(getWorkItemMock).toHaveBeenCalledWith({
      workItemId: 'PROJ-12',
      projectId: 'project-1',
      workspaceId: 'workspace-1'
    })
    expect(result).toEqual({
      identifier: 'PROJ-12',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workItem: item
    })
  })

  it('returns null when the enclosing worktree has no Plane link', async () => {
    const runtime = createRuntime()
    ;(runtime as unknown as ResolverInternals).resolveWorktreeForContainedPath = async () => ({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree'
    })

    const result = await runtime.planeResolveCurrentWorkItem({
      cwd: '/tmp/worktree',
      remote: false
    })

    expect(result).toBeNull()
    expect(getWorkItemMock).not.toHaveBeenCalled()
  })

  it('returns null when no worktree contains the cwd', async () => {
    const runtime = createRuntime()
    ;(runtime as unknown as ResolverInternals).resolveWorktreeForContainedPath = async () => null

    const result = await runtime.planeResolveCurrentWorkItem({
      cwd: '/tmp/elsewhere',
      remote: false
    })

    expect(result).toBeNull()
    expect(getWorkItemMock).not.toHaveBeenCalled()
  })
})
