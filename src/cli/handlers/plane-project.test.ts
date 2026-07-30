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

function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'proj-1',
    identifier: 'BILL',
    name: 'Billing revamp',
    workspaceSlug: 'acme',
    ...overrides
  }
}

describe('orca plane project CLI handlers', () => {
  const originalEnv = { ...process.env }
  let logged: string[] = []

  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.env = { ...originalEnv }
    delete process.env.ORCA_WORKTREE_ID
    delete process.env.ORCA_TERMINAL_HANDLE
    delete process.env.ORCA_PAIRING_CODE
    delete process.env.ORCA_ENVIRONMENT
    process.exitCode = undefined
    logged = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('maps project create to plane.createProject', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, project: project() }))

    await main(
      [
        'plane',
        'project',
        'create',
        '--name',
        'Billing revamp',
        '--identifier',
        'BILL',
        '--description',
        'Q3 rewrite',
        '--workspace',
        'acme',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith(
      'plane.createProject',
      {
        name: 'Billing revamp',
        identifier: 'BILL',
        description: 'Q3 rewrite',
        workspace: 'acme'
      },
      WRITE_OPTS
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('prints the created project id so the next command can use --project', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, project: project() }))

    await main(
      ['plane', 'project', 'create', '--name', 'Billing revamp', '--identifier', 'BILL'],
      '/tmp/repo'
    )

    expect(logged.join('\n')).toContain('proj-1')
    expect(logged.join('\n')).toContain('BILL')
  })

  it('surfaces a Plane rejection as a CLI failure', async () => {
    queueFixtures(
      callMock,
      okFixture('req', { ok: false, error: 'Identifier BILL is already taken' })
    )

    await main(
      ['plane', 'project', 'create', '--name', 'Billing revamp', '--identifier', 'BILL', '--json'],
      '/tmp/repo'
    )

    expect(process.exitCode).toBe(1)
  })

  it('rejects --workspace all before any RPC', async () => {
    await main(
      [
        'plane',
        'project',
        'create',
        '--name',
        'Billing revamp',
        '--identifier',
        'BILL',
        '--workspace',
        'all'
      ],
      '/tmp/repo'
    )

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('requires --identifier on create', async () => {
    await main(['plane', 'project', 'create', '--name', 'Billing revamp'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('maps project update to plane.updateProject with only the passed fields', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, project: project({ name: 'Billing' }) }))

    await main(
      ['plane', 'project', 'update', '--project', 'proj-1', '--name', 'Billing', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith(
      'plane.updateProject',
      {
        projectId: 'proj-1',
        name: 'Billing',
        identifier: undefined,
        description: undefined,
        workspace: undefined
      },
      WRITE_OPTS
    )
  })

  it('forwards an empty --description so update can clear it', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true, project: project() }))

    await main(
      ['plane', 'project', 'update', '--project', 'proj-1', '--description', '', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith(
      'plane.updateProject',
      expect.objectContaining({ description: '' }),
      WRITE_OPTS
    )
  })

  it('rejects an update with no field flags before any RPC', async () => {
    await main(['plane', 'project', 'update', '--project', 'proj-1', '--json'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('maps archive and unarchive to plane.setProjectArchived', async () => {
    queueFixtures(callMock, okFixture('req', { ok: true }))
    await main(['plane', 'project', 'archive', '--project', 'proj-1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith(
      'plane.setProjectArchived',
      { projectId: 'proj-1', archived: true, workspace: undefined },
      WRITE_OPTS
    )

    callMock.mockReset()
    queueFixtures(callMock, okFixture('req', { ok: true }))
    await main(['plane', 'project', 'unarchive', '--project', 'proj-1', '--json'], '/tmp/repo')
    expect(callMock).toHaveBeenCalledWith(
      'plane.setProjectArchived',
      { projectId: 'proj-1', archived: false, workspace: undefined },
      WRITE_OPTS
    )
  })

  // The conceptual clash the reporter hit: Plane has no parent project, and the
  // help is where a caller reaching for a subproject finds that out.
  it('states in create help that Plane does not nest projects', async () => {
    await main(['plane', 'project', 'create', '--help'], '/tmp/repo')

    const help = logged.join('\n')
    expect(help).toContain('does NOT nest projects')
    expect(help).toContain('module')
    expect(help).toContain('--parent')
    expect(callMock).not.toHaveBeenCalled()
  })
})
