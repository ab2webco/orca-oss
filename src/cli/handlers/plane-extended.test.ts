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
    labelIds: [],
    assignees: [],
    updatedAt: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-24T00:00:00.000Z',
    ...overrides
  }
}

describe('orca plane extended CLI handlers', () => {
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

  // ── Part A: create / save-issue new flags ──

  it('resolves --parent to a UUID and forwards dates on create', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem({ id: 'parent-uuid', identifier: 'PROJ-1' })),
      okFixture('req', { ok: true, id: 'wi9', identifier: 'PROJ-9', url: 'https://x/PROJ-9/' })
    )
    await main(
      [
        'plane',
        'create',
        '--project',
        'p1',
        '--title',
        'Child',
        '--parent',
        'PROJ-1',
        '--start-date',
        '2026-01-01',
        '--target-date',
        '2026-02-01',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-1',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.createWorkItem',
      {
        projectId: 'p1',
        title: 'Child',
        workspaceId: undefined,
        parentId: 'parent-uuid',
        startDate: '2026-01-01',
        targetDate: '2026-02-01'
      },
      WRITE_OPTS
    )
  })

  it('sets description from --body and clears the parent with --parent null on save-issue', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(
      [
        'plane',
        'save-issue',
        'PROJ-12',
        '--project',
        'p1',
        '--body',
        'Updated',
        '--parent',
        'null',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { description: 'Updated', parentId: null }
      },
      WRITE_OPTS
    )
  })

  // ── Part B: delete / states delete ──

  it('resolves the id to a UUID before delete', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(['plane', 'delete', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.deleteWorkItem',
      { projectId: 'p1', workItemId: 'wi1', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  it('routes the rm alias to delete', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(['plane', 'rm', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.deleteWorkItem',
      expect.anything(),
      WRITE_OPTS
    )
  })

  it('maps states delete to plane.deleteState with the state id directly', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true }))
    await main(['plane', 'states', 'delete', 's1', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith(
      'plane.deleteState',
      { projectId: 'p1', stateId: 's1', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  it('rejects --workspace all for delete', async () => {
    await main(
      ['plane', 'delete', 'PROJ-12', '--project', 'p1', '--workspace', 'all', '--json'],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  // ── Part C: relations ──

  it('resolves both work items and maps relation add', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem()),
      okFixture('req1', workItem({ id: 'wi2', identifier: 'PROJ-15' })),
      okFixture('req', { ok: true })
    )
    await main(
      [
        'plane',
        'relation',
        'add',
        'PROJ-12',
        '--related',
        'PROJ-15',
        '--type',
        'blocks',
        '--project',
        'p1',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.getWorkItem', {
      workItemId: 'PROJ-15',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.addWorkItemRelation',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        relationType: 'blocking',
        relatedWorkItemId: 'wi2',
        workspaceId: undefined
      },
      WRITE_OPTS
    )
  })

  it('rejects an unknown relation --type', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()))
    await main(
      [
        'plane',
        'relation',
        'add',
        'PROJ-12',
        '--related',
        'PROJ-15',
        '--type',
        'bogus',
        '--project',
        'p1',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(process.exitCode).toBe(1)
    expect(callMock).not.toHaveBeenCalledWith(
      'plane.addWorkItemRelation',
      expect.anything(),
      expect.anything()
    )
  })

  it('maps relation list to plane.listWorkItemRelations', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', []))
    await main(['plane', 'relation', 'list', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listWorkItemRelations', {
      projectId: 'p1',
      workItemId: 'wi1',
      workspaceId: undefined
    })
  })

  // ── Part C: attach (links) ──

  it('maps attach add to plane.addWorkItemLink', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem()),
      okFixture('req', { ok: true, link: { id: 'l1', url: 'https://x.dev', title: 'Docs' } })
    )
    await main(
      [
        'plane',
        'attach',
        'add',
        'PROJ-12',
        '--url',
        'https://x.dev',
        '--title',
        'Docs',
        '--project',
        'p1',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.addWorkItemLink',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        url: 'https://x.dev',
        title: 'Docs',
        workspaceId: undefined
      },
      WRITE_OPTS
    )
  })

  it('maps attach list and remove to their RPCs', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', []))
    await main(['plane', 'attach', 'list', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listWorkItemLinks', {
      projectId: 'p1',
      workItemId: 'wi1',
      workspaceId: undefined
    })
    callMock.mockReset()
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', { ok: true }))
    await main(
      ['plane', 'attach', 'remove', 'PROJ-12', '--link', 'l1', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.deleteWorkItemLink',
      { projectId: 'p1', workItemId: 'wi1', linkId: 'l1', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  // ── Part C: labels ──

  it('maps label create to plane.createLabel', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, label: { id: 'lab1', name: 'Bug' } }))
    await main(
      [
        'plane',
        'label',
        'create',
        '--project',
        'p1',
        '--name',
        'Bug',
        '--color',
        '#ef4444',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledWith(
      'plane.createLabel',
      { projectId: 'p1', name: 'Bug', color: '#ef4444', workspaceId: undefined },
      WRITE_OPTS
    )
  })

  it('adds label ids incrementally onto the current set', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem({ labelIds: ['l0'] })),
      okFixture('req', { ok: true })
    )
    await main(
      [
        'plane',
        'label',
        'add',
        'PROJ-12',
        '--label',
        'l1',
        '--label',
        'l2',
        '--project',
        'p1',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'PROJ-12',
      projectId: 'p1',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { labelIds: ['l0', 'l1', 'l2'] }
      },
      WRITE_OPTS
    )
  })

  it('removes label ids from the current set', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem({ labelIds: ['l0', 'l1'] })),
      okFixture('req', { ok: true })
    )
    await main(
      ['plane', 'label', 'remove', 'PROJ-12', '--label', 'l1', '--project', 'p1', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.updateWorkItem',
      {
        projectId: 'p1',
        workItemId: 'wi1',
        workspaceId: undefined,
        updates: { labelIds: ['l0'] }
      },
      WRITE_OPTS
    )
  })

  it('rejects --workspace all for label add', async () => {
    await main(
      [
        'plane',
        'label',
        'add',
        'PROJ-12',
        '--label',
        'l1',
        '--project',
        'p1',
        '--workspace',
        'all',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  // ── Part C: comment list ──

  it('maps comment list to plane.listWorkItemComments after resolving the UUID', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req', []))
    await main(['plane', 'comment', 'list', 'PROJ-12', '--project', 'p1', '--json'], '/tmp/repo')
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
})
