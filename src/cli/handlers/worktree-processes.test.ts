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
      remotePairingCode?: string | null,
      environmentSelector?: string | null
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

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const LISTED = {
  supported: true,
  root: '/tmp/wt',
  processes: [
    {
      pid: 70285,
      ppid: 1,
      command: '/bin/bash ./watch-pr-comments.sh',
      cwd: '/tmp/wt',
      startedAt: 'Tue Oct 27 08:05:00 2026'
    }
  ],
  stopped: [],
  protected: []
}

describe('orca worktree processes (ORCA-678)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('lists the processes of one worktree without stopping them', async () => {
    queueFixtures(callMock, okFixture('req_1', LISTED))

    await main(['worktree', 'processes', '--worktree', 'path:/tmp/wt'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('worktree.processes', {
      worktree: 'path:/tmp/wt',
      stop: false,
      callerPid: process.pid
    })
    const output = String(vi.mocked(console.log).mock.calls[0][0])
    expect(output).toContain('70285')
    expect(output).toContain('/bin/bash ./watch-pr-comments.sh')
    expect(output).toContain('--stop')
  })

  it('stops them with --stop and prints JSON with --json', async () => {
    queueFixtures(callMock, okFixture('req_2', { ...LISTED, stopped: [70285] }))

    await main(['worktree', 'processes', '--worktree', 'path:/tmp/wt', '--stop', '--json'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('worktree.processes', {
      worktree: 'path:/tmp/wt',
      stop: true,
      callerPid: process.pid
    })
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(printed.result.stopped).toEqual([70285])
  })

  it('says plainly when the host cannot list processes', async () => {
    queueFixtures(
      callMock,
      okFixture('req_3', {
        supported: false,
        root: 'C:\\wt',
        reason: 'per-process cwd is not readable on Windows'
      })
    )

    await main(['worktree', 'processes', '--worktree', 'path:C:\\wt'], '/tmp')

    expect(String(vi.mocked(console.log).mock.calls[0][0])).toContain(
      'per-process cwd is not readable on Windows'
    )
  })
})

describe('orca worktree rm on a busy worktree (ORCA-678)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('names the processes still inside and the --stop command, without stopping them', async () => {
    callMock.mockRejectedValueOnce(new Error('EBUSY: resource busy or locked'))
    queueFixtures(
      callMock,
      okFixture('req_4', { ...LISTED, processes: [...LISTED.processes], protected: [] })
    )

    await main(['worktree', 'rm', '--worktree', 'path:/tmp/wt'], '/tmp')

    expect(callMock).toHaveBeenNthCalledWith(2, 'worktree.processes', {
      worktree: 'path:/tmp/wt',
      stop: false,
      callerPid: process.pid
    })
    const stderr = vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .join('\n')
    expect(stderr).toContain('70285 /bin/bash ./watch-pr-comments.sh')
    expect(stderr).toContain(
      'Stop the orphans with: orca worktree processes --worktree path:/tmp/wt --stop'
    )
    expect(stderr).toContain('EBUSY')
    expect(process.exitCode).toBe(1)
  })

  it('does not list processes when rm is refused for another reason', async () => {
    callMock.mockRejectedValueOnce(new Error('ticket ORCA-1 has a working game member here'))
    await main(['worktree', 'rm', '--worktree', 'path:/tmp/wt'], '/tmp')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })

  it('does not list processes when the removal succeeds', async () => {
    queueFixtures(callMock, okFixture('req_5', { removed: true }))
    await main(['worktree', 'rm', '--worktree', 'path:/tmp/wt'], '/tmp')
    expect(callMock).toHaveBeenCalledTimes(1)
  })
})
