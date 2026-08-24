import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneWorkItem } from '../../shared/plane-types'
import type { WorktreeMeta } from '../../shared/types'
import type * as PlaneWorkItemsModule from '../plane/work-items'

const { getWorkItemMock } = vi.hoisted(() => ({ getWorkItemMock: vi.fn() }))

vi.mock('../plane/work-items', async (importActual) => ({
  ...(await importActual<typeof PlaneWorkItemsModule>()),
  getWorkItem: getWorkItemMock
}))

import { OrcaRuntimeService } from './orca-runtime'

const REPO_ID = 'repo-1'
const WORKTREE_PATH = '/tmp/orca-context-worktree'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const OTHER_WORKTREE_PATH = '/tmp/orca-other-worktree'
const OTHER_WORKTREE_ID = `${REPO_ID}::${OTHER_WORKTREE_PATH}`
const FOLDER_WORKSPACE_KEY = 'folder:folder-1'
const TAB_ID = '11111111-1111-4111-8111-111111111111'
const LEAF_ID = '22222222-2222-4222-8222-222222222222'

type RuntimeInternals = {
  listResolvedWorktrees: () => Promise<unknown[]>
  resolveLineageCandidateForTaskId: (taskId: string) => Promise<unknown>
}

function makeStore(meta: Partial<WorktreeMeta> = {}, connectionId: string | null = null) {
  const repo = {
    id: REPO_ID,
    path: '/tmp/orca-repo',
    displayName: 'orca-repo',
    badgeColor: 'blue',
    addedAt: 1,
    connectionId
  }
  return {
    getRepo: vi.fn((id: string) => (id === REPO_ID ? repo : undefined)),
    getRepos: vi.fn(() => [repo]),
    getAllWorktreeMeta: vi.fn(() => ({ [WORKTREE_ID]: meta })),
    getWorktreeMeta: vi.fn((id: string) => (id === WORKTREE_ID ? meta : undefined)),
    setWorktreeMeta: vi.fn(),
    getSettings: vi.fn(() => ({ workspaceDir: '/tmp/workspaces' }))
  }
}

function makeRuntime(
  meta: Partial<WorktreeMeta> = {},
  repoConnectionId: string | null = null,
  ptyConnectionId: string | null = repoConnectionId,
  ptyWorktreeId = WORKTREE_ID
) {
  const runtime = new OrcaRuntimeService(makeStore(meta, repoConnectionId) as never)
  const handle = runtime.preAllocateHandleForPty('pty-context')
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
  runtime.registerPty('pty-context', ptyWorktreeId, ptyConnectionId, {
    tabId: TAB_ID,
    leafId: LEAF_ID
  })
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: TAB_ID,
        worktreeId: ptyWorktreeId,
        title: 'Context',
        activeLeafId: LEAF_ID,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: TAB_ID,
        worktreeId: ptyWorktreeId,
        leafId: LEAF_ID,
        paneRuntimeId: 1,
        ptyId: 'pty-context',
        paneTitle: null
      }
    ]
  })
  const internals = runtime as unknown as RuntimeInternals
  vi.spyOn(internals, 'listResolvedWorktrees').mockResolvedValue([
    {
      id: OTHER_WORKTREE_ID,
      path: OTHER_WORKTREE_PATH,
      repoId: REPO_ID,
      branch: 'other'
    }
  ])
  return { runtime, handle, internals }
}

function planeWorkItem(): PlaneWorkItem {
  return {
    id: 'wi1',
    identifier: 'ORCA-283',
    sequenceId: 283,
    title: 'Preserve live terminal context authority',
    url: 'https://plane.example.com/ORCA-283',
    project: { id: 'project-1', identifier: 'ORCA', name: 'Orca' },
    state: { id: 'state-1', name: 'In Progress', group: 'started' },
    labels: [],
    assignees: [],
    updatedAt: '2026-08-23T00:00:00.000Z',
    createdAt: '2026-08-23T00:00:00.000Z'
  }
}

describe('live terminal context authority', () => {
  beforeEach(() => {
    getWorkItemMock.mockReset()
  })

  it('resolves lineage task context when a populated catalog omits the live PTY worktree', async () => {
    const { runtime, handle, internals } = makeRuntime({ instanceId: 'parent-instance' })
    runtime.setOrchestrationDb({
      getDispatchContext: vi.fn(() => ({ assignee_handle: handle })),
      getTask: vi.fn()
    } as never)

    await expect(internals.resolveLineageCandidateForTaskId('task_283')).resolves.toMatchObject({
      source: 'orchestration-context',
      taskId: 'task_283',
      parent: {
        type: 'worktree',
        worktree: { id: WORKTREE_ID, path: WORKTREE_PATH, instanceId: 'parent-instance' }
      }
    })
  })

  it('keeps matching SSH PTY authority scoped to its execution host', async () => {
    const { runtime, handle, internals } = makeRuntime(
      { hostId: 'ssh:ssh-a', instanceId: 'ssh-parent-instance' },
      'ssh-a',
      'ssh-a'
    )
    runtime.setOrchestrationDb({
      getDispatchContext: vi.fn(() => ({ assignee_handle: handle })),
      getTask: vi.fn()
    } as never)

    await expect(internals.resolveLineageCandidateForTaskId('task_ssh')).resolves.toMatchObject({
      parent: {
        worktree: {
          id: WORKTREE_ID,
          hostId: 'ssh:ssh-a',
          instanceId: 'ssh-parent-instance'
        }
      }
    })
  })

  it('resolves Linear current issue when a populated catalog omits the live PTY worktree', async () => {
    const { runtime, handle } = makeRuntime({
      linkedLinearIssue: 'ENG-283',
      linkedLinearIssueWorkspaceId: 'workspace-1'
    })

    await expect(
      runtime.linearResolveCurrentIssue({ terminalHandle: handle, worktreeId: WORKTREE_ID })
    ).resolves.toMatchObject({
      identifier: 'ENG-283',
      workspaceId: 'workspace-1',
      worktreeId: WORKTREE_ID,
      worktreePath: WORKTREE_PATH
    })
  })

  it('resolves Plane current context when a populated catalog omits the live PTY worktree', async () => {
    const { runtime, handle } = makeRuntime({
      linkedPlaneWorkItem: {
        identifier: 'ORCA-283',
        projectId: 'project-1',
        workspaceId: 'workspace-1'
      }
    })
    getWorkItemMock.mockResolvedValue(planeWorkItem())

    await expect(
      runtime.planeResolveCurrentWorkItem({ terminalHandle: handle, worktreeId: WORKTREE_ID })
    ).resolves.toMatchObject({
      identifier: 'ORCA-283',
      projectId: 'project-1',
      workspaceId: 'workspace-1'
    })
    expect(getWorkItemMock).toHaveBeenCalledOnce()
  })

  it('keeps stale encoded ids rejected by create and activate selectors', async () => {
    const { runtime } = makeRuntime()
    const spawn = vi.fn(async () => ({ id: 'pty-should-not-spawn' }))
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await expect(runtime.createTerminal(`id:${WORKTREE_ID}`)).rejects.toThrow('selector_not_found')
    await expect(runtime.activateManagedWorktree(`id:${WORKTREE_ID}`)).rejects.toThrow(
      'selector_not_found'
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not transfer live PTY authority across SSH connections', async () => {
    const { runtime, handle } = makeRuntime({ linkedLinearIssue: 'ENG-283' }, 'ssh-a', 'ssh-b')

    await expect(
      runtime.linearResolveCurrentIssue({ terminalHandle: handle, worktreeId: WORKTREE_ID })
    ).rejects.toMatchObject({ code: 'linear_issue_required' })
  })

  it('does not coerce a folder-backed PTY into a worktree', async () => {
    const { runtime, handle } = makeRuntime({}, null, null, FOLDER_WORKSPACE_KEY)

    await expect(
      runtime.linearResolveCurrentIssue({
        terminalHandle: handle,
        worktreeId: FOLDER_WORKSPACE_KEY
      })
    ).rejects.toMatchObject({ code: 'linear_issue_required' })
  })

  it('does not retain context authority after the PTY disconnects', async () => {
    const { runtime, handle } = makeRuntime({ linkedLinearIssue: 'ENG-283' })
    runtime.onPtyExit('pty-context', 0)

    await expect(
      runtime.linearResolveCurrentIssue({ terminalHandle: handle, worktreeId: WORKTREE_ID })
    ).rejects.toMatchObject({ code: 'linear_issue_required' })
  })

  it('preserves Linear and Plane worktree hint equality guards', async () => {
    const { runtime, handle } = makeRuntime({ linkedLinearIssue: 'ENG-283' })

    await expect(
      runtime.linearResolveCurrentIssue({ terminalHandle: handle, worktreeId: OTHER_WORKTREE_ID })
    ).rejects.toMatchObject({ code: 'linear_permission_denied' })
    await expect(
      runtime.planeResolveCurrentWorkItem({ terminalHandle: handle, worktreeId: OTHER_WORKTREE_ID })
    ).resolves.toBeNull()
  })
})
