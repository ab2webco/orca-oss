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
import { okFixture } from '../test-fixtures'

describe('orca plane planning handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('lists cycles through the planning RPC', async () => {
    callMock.mockResolvedValue(okFixture('req', [{ id: 'cycle-1', name: 'Sprint 1' }]))

    await main(
      ['plane', 'cycle', 'list', '--project', 'project-1', '--workspace', 'acme', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('plane.listPlanningContainers', {
      kind: 'cycle',
      projectId: 'project-1',
      workspaceId: 'acme'
    })
  })

  it('lists module work items through the planning RPC', async () => {
    callMock.mockResolvedValue(okFixture('req', []))

    await main(
      ['plane', 'module', 'issues', 'module-1', '--project', 'project-1', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('plane.listPlanningWorkItems', {
      kind: 'module',
      projectId: 'project-1',
      containerId: 'module-1',
      workspaceId: undefined
    })
  })

  it('forwards every repeated --item in one cycle mutation', async () => {
    callMock.mockResolvedValue(okFixture('req', { ok: true }))

    await main(
      [
        'plane',
        'cycle',
        'add-items',
        'cycle-1',
        '--item',
        'item-1',
        '--item',
        'item-2',
        '--project',
        'project-1',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith(
      'plane.addPlanningWorkItems',
      {
        kind: 'cycle',
        projectId: 'project-1',
        containerId: 'cycle-1',
        workItemIds: ['item-1', 'item-2'],
        workspaceId: undefined
      },
      { timeoutMs: 75_000 }
    )
  })

  it('rejects add-items without --item before calling the runtime', async () => {
    await main(
      ['plane', 'module', 'add-items', 'module-1', '--project', 'project-1', '--json'],
      '/tmp/repo'
    )

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('rejects a missing --project before calling the runtime', async () => {
    await main(['plane', 'cycle', 'list', '--json'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})
