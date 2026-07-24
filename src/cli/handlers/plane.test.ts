import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode = process.env.ORCA_PAIRING_CODE ?? null,
      environmentSelector = process.env.ORCA_ENVIRONMENT ?? null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return { RuntimeClient, RuntimeClientError, RuntimeRpcFailureError }
})

import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const WRITE_OPTS = { timeoutMs: 75_000 }

function workItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wi1',
    identifier: 'PROJ-12',
    sequenceId: 12,
    title: 'Fix login',
    url: 'https://app.plane.so/acme/browse/PROJ-12/',
    project: { id: 'p1', identifier: 'PROJ', name: 'Platform' },
    state: { id: 's0', name: 'Todo', group: 'unstarted' },
    labels: [],
    assignees: [],
    updatedAt: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-24T00:00:00.000Z',
    ...overrides
  }
}

describe('orca plane CLI handlers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.env = { ...originalEnv }
    delete process.env.ORCA_WORKTREE_ID
    delete process.env.ORCA_TERMINAL_HANDLE
    delete process.env.ORCA_PAIRING_CODE
    delete process.env.ORCA_ENVIRONMENT
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('maps issue reads to plane.getWorkItem', async () => {
    queueFixtures(callMock, okFixture('req', workItem()))
    await main(['plane', 'issue', 'PROJ-12', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith('plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: undefined,
      workspaceId: undefined
    })
  })

  it('fetches comments from the resolved project when --comments is set', async () => {
    queueFixtures(callMock, okFixture('req', workItem()), okFixture('req2', []))
    await main(
      ['plane', 'issue', 'PROJ-12', '--comments', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listWorkItemComments', {
      projectId: 'p1',
      workItemId: 'wi1',
      workspaceId: undefined
    })
  })

  it('maps list with filter and applies client-side limit', async () => {
    queueFixtures(callMock, okFixture('req', [workItem(), workItem({ id: 'wi2' })]))
    await main(['plane', 'list', '--filter', 'assigned', '--limit', '1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith('plane.listWorkItems', {
      projectId: undefined,
      filter: 'assigned',
      workspaceId: undefined
    })
  })

  it('filters list by --state and --priority client-side', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => {
      logs.push(String(value))
    })
    queueFixtures(
      callMock,
      okFixture('req', [
        workItem({
          id: 'a',
          state: { id: 's0', name: 'Todo', group: 'unstarted' },
          priority: 'high'
        }),
        workItem({
          id: 'b',
          state: { id: 's1', name: 'Done', group: 'completed' },
          priority: 'high'
        }),
        workItem({
          id: 'c',
          state: { id: 's0', name: 'Todo', group: 'unstarted' },
          priority: 'low'
        })
      ])
    )
    await main(['plane', 'list', '--state', 'todo', '--priority', 'High', '--json'], '/tmp/repo')
    const printed = JSON.parse(logs.join('\n')) as { result: { id: string }[] }
    expect(printed.result.map((item) => item.id)).toEqual(['a'])
  })

  it('fetches direct sub-issues with --children', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => {
      logs.push(String(value))
    })
    queueFixtures(
      callMock,
      okFixture('req', workItem({ id: 'epic-1', identifier: 'ORCA-25' })),
      okFixture('req2', [
        workItem({ id: 'c1', identifier: 'ORCA-26', parentId: 'epic-1' }),
        workItem({ id: 'x1', identifier: 'ORCA-99', parentId: 'other' }),
        workItem({ id: 'c2', identifier: 'ORCA-27', parentId: 'epic-1' })
      ])
    )
    await main(
      ['plane', 'issue', 'ORCA-25', '--children', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listWorkItems', {
      projectId: 'p1',
      filter: 'everything',
      workspaceId: undefined
    })
    const printed = JSON.parse(logs.join('\n')) as { result: { children: { id: string }[] } }
    expect(printed.result.children.map((child) => child.id)).toEqual(['c1', 'c2'])
  })

  it('maps search to plane.searchWorkItems', async () => {
    queueFixtures(callMock, okFixture('req', []))
    await main(['plane', 'search', 'auth bug', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith('plane.searchWorkItems', {
      query: 'auth bug',
      projectId: undefined,
      workspaceId: undefined
    })
  })

  it('resolves the identifier to the work item UUID before a status write', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem()),
      okFixture('req', [{ id: 's1', name: 'In Review', group: 'started' }]),
      okFixture('req2', { ok: true })
    )
    await main(
      ['plane', 'status', 'set', 'PROJ-12', '--to', 'In Review', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listStates', {
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { stateId: 's1' }
      },
      WRITE_OPTS
    )
  })

  it('resolves the viewer id for assignee set --me', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem()),
      okFixture('req', { id: 'u1', displayName: 'Me', email: null }),
      okFixture('req2', { ok: true })
    )
    await main(
      ['plane', 'assignee', 'set', 'PROJ-12', '--me', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.getMe', { workspaceId: undefined })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { assigneeIds: ['u1'] }
      },
      WRITE_OPTS
    )
  })

  it('clears the assignee with an empty id set', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(['plane', 'assignee', 'clear', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith(
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { assigneeIds: [] }
      },
      WRITE_OPTS
    )
  })

  it('maps priority set to a priority update', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(
      ['plane', 'priority', 'set', 'PROJ-12', '--to', 'high', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledWith(
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { priority: 'high' }
      },
      WRITE_OPTS
    )
  })

  it('maps comment add to plane.addWorkItemComment', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true, id: 'c1' }))
    await main(
      ['plane', 'comment', 'add', 'PROJ-12', '--body', 'Ready.', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledWith(
      'plane.addWorkItemComment',
      { projectId: 'p1', workItemId: 'wi1', body: 'Ready.', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  it('maps comment delete to plane.deleteWorkItemComment with the resolved UUID', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(
      ['plane', 'comment', 'delete', 'c1', 'PROJ-12', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.deleteWorkItemComment',
      { projectId: 'p1', workItemId: 'wi1', commentId: 'c1', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  it('deletes a comment on the current worktree work item', async () => {
    queueFixtures(callMock, okFixture('req0', currentResolve()), okFixture('req', { ok: true }))
    await main(['plane', 'comment', 'delete', 'c1', '--current', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.resolveCurrentWorkItem', {
      remote: false,
      cwd: '/tmp/repo'
    })
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.deleteWorkItemComment',
      { projectId: 'p1', workItemId: 'wi1', commentId: 'c1', workspaceId: 'w1' },
      WRITE_OPTS
    )
  })

  it('rejects --workspace all for comment delete', async () => {
    await main(
      ['plane', 'comment', 'delete', 'c1', 'PROJ-12', '--project', 'p1', '--workspace', 'all'],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('maps save-issue to a partial updateWorkItem PATCH', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(
      ['plane', 'save-issue', 'PROJ-12', '--project', 'p1', '--title', 'New title', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledWith(
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { title: 'New title' }
      },
      WRITE_OPTS
    )
  })

  it('throws plane_work_item_not_found when an explicit id does not resolve', async () => {
    queueFixtures(callMock, okFixture('req', null))
    await main(
      ['plane', 'priority', 'clear', 'MISSING-1', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('plane.getWorkItem', {
      workItemId: 'MISSING-1',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(process.exitCode).toBe(1)
  })

  it('maps project list to plane.listProjects', async () => {
    queueFixtures(callMock, okFixture('req', []))
    await main(['plane', 'project', 'list', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith('plane.listProjects', { workspaceId: undefined })
  })

  it('maps states create to plane.createState', async () => {
    queueFixtures(
      callMock,
      okFixture('req', { ok: true, state: { id: 's1', name: 'In Review', group: 'started' } })
    )
    await main(
      [
        'plane',
        'states',
        'create',
        '--project',
        'p1',
        '--name',
        'In Review',
        '--group',
        'started',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledWith(
      'plane.createState',
      {
        projectId: 'p1',
        workspaceId: undefined,
        name: 'In Review',
        group: 'started',
        color: undefined
      },
      WRITE_OPTS
    )
  })

  it('maps labels list to plane.listLabels', async () => {
    queueFixtures(callMock, okFixture('req', []))
    await main(['plane', 'labels', 'list', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith('plane.listLabels', {
      projectId: 'p1',
      workspaceId: undefined
    })
  })

  it('maps members list to plane.listMembers', async () => {
    queueFixtures(callMock, okFixture('req', []))
    await main(['plane', 'members', 'list', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith('plane.listMembers', {
      workspaceId: undefined,
      projectId: 'p1'
    })
  })

  it('maps a minimal create to plane.createWorkItem', async () => {
    queueFixtures(
      callMock,
      okFixture('req', {
        ok: true,
        id: 'wi9',
        identifier: 'PROJ-9',
        url: 'https://app.plane.so/acme/browse/PROJ-9/'
      })
    )
    await main(['plane', 'create', '--project', 'p1', '--title', 'New task', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith(
      'plane.createWorkItem',
      { projectId: 'p1', title: 'New task', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  it('resolves state, assignee, priority, and labels before create', async () => {
    queueFixtures(
      callMock,
      okFixture('req', [{ id: 's1', name: 'In Progress', group: 'started' }]),
      okFixture('req2', { id: 'u1', displayName: 'Me', email: null }),
      okFixture('req3', {
        ok: true,
        id: 'wi9',
        identifier: 'PROJ-9',
        url: 'https://app.plane.so/acme/browse/PROJ-9/'
      })
    )
    await main(
      [
        'plane',
        'create',
        '--project',
        'p1',
        '--title',
        'Enriched',
        '--state',
        'In Progress',
        '--assignee',
        'me',
        '--priority',
        'high',
        '--label',
        'l1',
        '--label',
        'l2',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.listStates', {
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.getMe', { workspaceId: undefined })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.createWorkItem',
      {
        projectId: 'p1',
        title: 'Enriched',
        workspaceId: undefined,
        stateId: 's1',
        assigneeIds: ['u1'],
        priority: 'high',
        labelIds: ['l1', 'l2']
      },
      WRITE_OPTS
    )
  })

  it('rejects --workspace all for create', async () => {
    await main(
      ['plane', 'create', '--project', 'p1', '--title', 'X', '--workspace', 'all', '--json'],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('rejects --workspace all for writes', async () => {
    await main(
      ['plane', 'priority', 'clear', 'PROJ-12', '--project', 'p1', '--workspace', 'all', '--json'],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('reads the current worktree work item without a second fetch for issue --current', async () => {
    queueFixtures(callMock, okFixture('req', currentResolve()))
    await main(['plane', 'issue', '--current', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('plane.resolveCurrentWorkItem', {
      remote: false,
      cwd: '/tmp/repo'
    })
  })

  it('resolves the current work item id and project before a status write', async () => {
    queueFixtures(
      callMock,
      okFixture('req', currentResolve()),
      okFixture('req2', [{ id: 's1', name: 'In Review', group: 'started' }]),
      okFixture('req3', { ok: true })
    )
    await main(['plane', 'status', 'set', '--current', '--to', 'In Review', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.resolveCurrentWorkItem', {
      remote: false,
      cwd: '/tmp/repo'
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listStates', {
      projectId: 'p1',
      workspaceId: 'w1'
    })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: 'w1',
        updates: { stateId: 's1' }
      },
      WRITE_OPTS
    )
  })

  it('threads the worktree/terminal hints into the resolve context', async () => {
    process.env.ORCA_WORKTREE_ID = 'wt-1'
    process.env.ORCA_TERMINAL_HANDLE = 'term-1'
    queueFixtures(callMock, okFixture('req', currentResolve()), okFixture('req2', { ok: true }))
    await main(['plane', 'assignee', 'clear', '--current', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.resolveCurrentWorkItem', {
      remote: false,
      cwd: '/tmp/repo',
      worktreeId: 'wt-1',
      terminalHandle: 'term-1'
    })
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.updateWorkItem',
      { projectId: 'p1', workItemId: 'wi1', workspaceId: 'w1', updates: { assigneeIds: [] } },
      WRITE_OPTS
    )
  })

  it('errors when the current worktree has no Plane link', async () => {
    queueFixtures(callMock, okFixture('req', null))
    await main(['plane', 'issue', '--current', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  it('rejects passing both an id and --current', async () => {
    await main(
      ['plane', 'status', 'set', 'PROJ-12', '--current', '--to', 'Done', '--json'],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('maps link to plane.linkCurrentWorkItem with the current-worktree context', async () => {
    queueFixtures(
      callMock,
      okFixture('req', {
        ok: true,
        linked: {
          identifier: 'PROJ-12',
          projectId: 'p1',
          workspaceId: 'w1',
          url: 'https://app.plane.so/acme/browse/PROJ-12/',
          workItem: workItem()
        }
      })
    )
    await main(['plane', 'link', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith(
      'plane.linkCurrentWorkItem',
      {
        context: { remote: false, cwd: '/tmp/repo' },
        identifier: 'PROJ-12',
        projectId: 'p1',
        workspaceId: undefined
      },
      WRITE_OPTS
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('rejects --workspace all for link', async () => {
    await main(
      ['plane', 'link', 'PROJ-12', '--project', 'p1', '--workspace', 'all', '--json'],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('errors when link cannot resolve a worktree', async () => {
    queueFixtures(callMock, okFixture('req', { ok: false, error: 'no_worktree' }))
    await main(['plane', 'link', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  it('errors when link cannot find the work item', async () => {
    queueFixtures(callMock, okFixture('req', { ok: false, error: 'work_item_not_found' }))
    await main(['plane', 'link', 'PROJ-999', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  it('maps unlink to plane.unlinkCurrentWorkItem with the current-worktree context', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, worktreeId: 'repo::/tmp/repo' }))
    await main(['plane', 'unlink', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith(
      'plane.unlinkCurrentWorkItem',
      { context: { remote: false, cwd: '/tmp/repo' } },
      WRITE_OPTS
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('errors when unlink cannot resolve a worktree', async () => {
    queueFixtures(callMock, okFixture('req', { ok: false, error: 'no_worktree' }))
    await main(['plane', 'unlink', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  it('errors on a --current write when the linked work item could not be fetched', async () => {
    queueFixtures(callMock, okFixture('req', currentResolve({ workItem: null })))
    await main(['plane', 'assignee', 'clear', '--current', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })
})

function currentResolve(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    identifier: 'PROJ-12',
    projectId: 'p1',
    workspaceId: 'w1',
    url: 'https://app.plane.so/acme/browse/PROJ-12/',
    workItem: workItem(),
    ...overrides
  }
}
