import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote = false
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()
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
const PROJECT_UUID = 'e665c0d5-22e7-495e-9ecf-3effee3ae370'
const ITEM_UUID = '38891d8b-2df0-4782-a3ad-7408d7aab472'

function workItem(): Record<string, unknown> {
  return {
    id: ITEM_UUID,
    identifier: 'ORCA-834',
    sequenceId: 834,
    title: 'Writes need the project UUID',
    url: 'https://plane.example/ab2web/browse/ORCA-834/',
    project: { id: PROJECT_UUID, identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: 's0', name: 'Todo', group: 'unstarted' },
    labels: [],
    assignees: [],
    updatedAt: '2026-10-27T00:00:00.000Z',
    createdAt: '2026-10-27T00:00:00.000Z'
  }
}

function jsonOutput(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => call.join(' '))
    .join('\n')
}

beforeEach(() => {
  vi.restoreAllMocks()
  callMock.mockReset()
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ORCA-834: the work item already names its project, so writes must not
// demand the project UUID on top of it.
describe('orca plane write target project resolution', () => {
  it('takes the project from the work item when --project is omitted', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', workItem()),
      okFixture('req1', [{ id: 's1', name: 'Done', group: 'completed' }]),
      okFixture('req2', { ok: true })
    )
    await main(['plane', 'status', 'set', 'ORCA-834', '--to', 'Done', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: 'ORCA-834',
      projectId: undefined,
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.listStates', {
      projectId: PROJECT_UUID,
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.updateWorkItem',
      {
        projectId: PROJECT_UUID,
        workItemId: ITEM_UUID,
        workspaceId: undefined,
        updates: { stateId: 's1' }
      },
      WRITE_OPTS
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('accepts the project identifier for --project and writes with the UUID', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req1', { ok: true }))
    await main(
      ['plane', 'comment', 'add', 'ORCA-834', '--body', 'Ready.', '--project', 'orca', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.addWorkItemComment',
      { projectId: PROJECT_UUID, workItemId: ITEM_UUID, body: 'Ready.', workspaceId: undefined },
      WRITE_OPTS
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('retries a UUID lookup across projects when --project is an identifier', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', null),
      okFixture('req1', workItem()),
      okFixture('req2', { ok: true })
    )
    await main(
      ['plane', 'priority', 'set', ITEM_UUID, '--to', 'high', '--project', 'ORCA', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'plane.getWorkItem', {
      workItemId: ITEM_UUID,
      projectId: 'ORCA',
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'plane.getWorkItem', {
      workItemId: ITEM_UUID,
      projectId: undefined,
      workspaceId: undefined
    })
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      'plane.updateWorkItem',
      {
        projectId: PROJECT_UUID,
        workItemId: ITEM_UUID,
        workspaceId: undefined,
        updates: { priority: 'high' }
      },
      WRITE_OPTS
    )
  })

  it('adds a label without --project, writing to the work item project', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()), okFixture('req1', { ok: true }))
    await main(['plane', 'label', 'add', 'ORCA-834', '--label', 'l1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.updateWorkItem',
      {
        projectId: PROJECT_UUID,
        workItemId: ITEM_UUID,
        workspaceId: undefined,
        updates: { labelIds: ['l1'] }
      },
      WRITE_OPTS
    )
  })

  it('refuses a write when --project names a different project than the work item', async () => {
    queueFixtures(callMock, okFixture('req0', workItem()))
    await main(
      ['plane', 'priority', 'clear', 'ORCA-834', '--project', 'BILL', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
    expect(jsonOutput()).toContain('belongs to project ORCA, not BILL')
  })

  it('accepts the project identifier for --project alongside --current', async () => {
    queueFixtures(
      callMock,
      okFixture('req0', {
        identifier: 'ORCA-834',
        projectId: PROJECT_UUID,
        workspaceId: 'w1',
        url: 'https://plane.example/ab2web/browse/ORCA-834/',
        workItem: workItem()
      }),
      okFixture('req1', { ok: true })
    )
    await main(
      ['plane', 'assignee', 'clear', '--current', '--project', 'ORCA', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      'plane.updateWorkItem',
      {
        projectId: PROJECT_UUID,
        workItemId: ITEM_UUID,
        workspaceId: 'w1',
        updates: { assigneeIds: [] }
      },
      WRITE_OPTS
    )
  })
})
