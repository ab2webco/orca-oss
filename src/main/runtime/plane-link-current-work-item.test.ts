import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PlaneWorkItem } from '../../shared/plane-types'
import type { LinkedPlaneWorkItem, WorktreeMeta } from '../../shared/types'
import type * as PlaneWorkItemsModule from '../plane/work-items'

const { getWorkItemMock } = vi.hoisted(() => ({ getWorkItemMock: vi.fn() }))

vi.mock('../plane/work-items', async (importActual) => ({
  ...(await importActual<typeof PlaneWorkItemsModule>()),
  getWorkItem: getWorkItemMock
}))

import { OrcaRuntimeService } from './orca-runtime'

type LinkInternals = {
  resolveWorktreeForContainedPath: (cwd: string) => Promise<{ id: string; path: string } | null>
  updateManagedWorktreeMeta: (selector: string, updates: Partial<WorktreeMeta>) => Promise<unknown>
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
    workspaceId: 'workspace-1',
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

describe('planeLinkCurrentWorkItem', () => {
  beforeEach(() => {
    getWorkItemMock.mockReset()
  })

  it('validates the work item and writes the link via the shared meta setter', async () => {
    const runtime = createRuntime()
    const metaWrites: { selector: string; updates: Partial<WorktreeMeta> }[] = []
    ;(runtime as unknown as LinkInternals).resolveWorktreeForContainedPath = async () => ({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree'
    })
    ;(runtime as unknown as LinkInternals).updateManagedWorktreeMeta = async (
      selector,
      updates
    ) => {
      metaWrites.push({ selector, updates })
      return null
    }
    const item = planeWorkItem()
    getWorkItemMock.mockResolvedValue(item)

    const result = await runtime.planeLinkCurrentWorkItem({
      context: { cwd: '/tmp/worktree', remote: false },
      identifier: 'PROJ-12',
      projectId: 'project-1'
    })

    expect(getWorkItemMock).toHaveBeenCalledWith({
      workItemId: 'PROJ-12',
      projectId: 'project-1',
      workspaceId: undefined
    })
    const expectedLink: LinkedPlaneWorkItem = {
      identifier: 'PROJ-12',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      url: 'https://plane.example.com/PROJ-12'
    }
    expect(metaWrites).toEqual([
      { selector: 'id:repo::/tmp/worktree', updates: { linkedPlaneWorkItem: expectedLink } }
    ])
    expect(result).toEqual({
      ok: true,
      linked: {
        identifier: 'PROJ-12',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        url: 'https://plane.example.com/PROJ-12',
        workItem: item
      }
    })
  })

  it('returns no_worktree without fetching or writing when cwd is outside a worktree', async () => {
    const runtime = createRuntime()
    const writeSpy = vi.fn()
    ;(runtime as unknown as LinkInternals).resolveWorktreeForContainedPath = async () => null
    ;(runtime as unknown as LinkInternals).updateManagedWorktreeMeta = writeSpy

    const result = await runtime.planeLinkCurrentWorkItem({
      context: { cwd: '/tmp/elsewhere', remote: false },
      identifier: 'PROJ-12',
      projectId: 'project-1'
    })

    expect(result).toEqual({ ok: false, error: 'no_worktree' })
    expect(getWorkItemMock).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('returns work_item_not_found and does not write when the id does not resolve', async () => {
    const runtime = createRuntime()
    const writeSpy = vi.fn()
    ;(runtime as unknown as LinkInternals).resolveWorktreeForContainedPath = async () => ({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree'
    })
    ;(runtime as unknown as LinkInternals).updateManagedWorktreeMeta = writeSpy
    getWorkItemMock.mockResolvedValue(null)

    const result = await runtime.planeLinkCurrentWorkItem({
      context: { cwd: '/tmp/worktree', remote: false },
      identifier: 'PROJ-999',
      projectId: 'project-1'
    })

    expect(result).toEqual({ ok: false, error: 'work_item_not_found' })
    expect(writeSpy).not.toHaveBeenCalled()
  })
})

describe('planeUnlinkCurrentWorkItem', () => {
  it('clears the link via the shared meta setter', async () => {
    const runtime = createRuntime()
    const metaWrites: { selector: string; updates: Partial<WorktreeMeta> }[] = []
    ;(runtime as unknown as LinkInternals).resolveWorktreeForContainedPath = async () => ({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree'
    })
    ;(runtime as unknown as LinkInternals).updateManagedWorktreeMeta = async (
      selector,
      updates
    ) => {
      metaWrites.push({ selector, updates })
      return null
    }

    const result = await runtime.planeUnlinkCurrentWorkItem({
      context: { cwd: '/tmp/worktree', remote: false }
    })

    expect(metaWrites).toEqual([
      { selector: 'id:repo::/tmp/worktree', updates: { linkedPlaneWorkItem: null } }
    ])
    expect(result).toEqual({ ok: true, worktreeId: 'repo::/tmp/worktree' })
  })

  it('returns no_worktree when cwd is outside a worktree', async () => {
    const runtime = createRuntime()
    const writeSpy = vi.fn()
    ;(runtime as unknown as LinkInternals).resolveWorktreeForContainedPath = async () => null
    ;(runtime as unknown as LinkInternals).updateManagedWorktreeMeta = writeSpy

    const result = await runtime.planeUnlinkCurrentWorkItem({
      context: { cwd: '/tmp/elsewhere', remote: false }
    })

    expect(result).toEqual({ ok: false, error: 'no_worktree' })
    expect(writeSpy).not.toHaveBeenCalled()
  })
})
