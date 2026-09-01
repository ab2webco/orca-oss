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

const intakeIssue = {
  id: 'intake-1',
  workItemId: 'issue-1',
  title: 'Customer cannot sign in',
  priority: 'high',
  status: -2,
  createdAt: '2026-08-29T12:00:00Z'
}

beforeEach(() => {
  vi.restoreAllMocks()
  callMock.mockReset()
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('orca plane intake handlers', () => {
  it('creates an intake item with only supported fields', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, intakeIssue }))

    await main(
      [
        'plane',
        'intake',
        'create',
        '--project',
        'project-1',
        '--title',
        'Customer cannot sign in',
        '--body',
        'Support report',
        '--priority',
        'high',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith(
      'plane.createIntakeIssue',
      {
        projectId: 'project-1',
        title: 'Customer cannot sign in',
        workspaceId: undefined,
        description: 'Support report',
        priority: 'high'
      },
      { timeoutMs: 75_000 }
    )
  })

  it('lists project intake and applies the requested limit', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((value: unknown) => logs.push(String(value)))
    queueFixtures(
      callMock,
      okFixture('req', [intakeIssue, { ...intakeIssue, id: 'intake-2', title: 'Second' }])
    )

    await main(
      ['plane', 'intake', 'list', '--project', 'project-1', '--limit', '1', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('plane.listIntakeIssues', {
      projectId: 'project-1',
      workspaceId: undefined
    })
    const output = JSON.parse(logs.join('\n')) as { result: { id: string }[] }
    expect(output.result.map((item) => item.id)).toEqual(['intake-1'])
  })

  it('rejects workspace all before creating', async () => {
    await main(
      [
        'plane',
        'intake',
        'create',
        '--project',
        'project-1',
        '--title',
        'Invalid scope',
        '--workspace',
        'all'
      ],
      '/tmp/repo'
    )

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})
