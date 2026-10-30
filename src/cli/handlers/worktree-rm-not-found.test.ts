import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
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

  return { RuntimeClient, RuntimeClientError }
})

import { main } from '../index'
import { RuntimeClientError } from '../runtime-client'

describe('orca worktree rm when no worktree matches (ORCA-866)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function printed(): string {
    return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
  }

  it('names the paired host and how to list its worktrees', async () => {
    callMock.mockRejectedValueOnce(
      new RuntimeClientError('selector_not_found', 'selector_not_found')
    )

    await main(
      ['worktree', 'rm', '--environment', 'imac', '--worktree', 'branch:fabolivark/orca-857'],
      '/tmp/repo'
    )

    expect(process.exitCode).toBe(1)
    expect(printed()).toContain('No worktree on imac matches branch:fabolivark/orca-857')
    expect(printed()).toContain('orca worktree list --environment imac')
  })

  it('names the environment chosen through ORCA_ENVIRONMENT', async () => {
    vi.stubEnv('ORCA_ENVIRONMENT', 'm1')
    callMock.mockRejectedValueOnce(
      new RuntimeClientError('selector_not_found', 'selector_not_found')
    )

    await main(['worktree', 'rm', '--worktree', 'name:orca-857'], '/tmp/repo')

    expect(printed()).toContain('No worktree on m1 matches name:orca-857')
    expect(printed()).toContain('orca worktree list --environment m1')
  })

  it('says the same locally without an environment', async () => {
    callMock.mockRejectedValueOnce(
      new RuntimeClientError('selector_not_found', 'selector_not_found')
    )

    await main(['worktree', 'rm', '--worktree', 'branch:gone', '--json'], '/tmp/repo')

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => call.join(' '))
      .join('\n')
    expect(`${output}\n${printed()}`).toContain('No worktree matches branch:gone')
    expect(`${output}\n${printed()}`).not.toContain('--environment')
  })

  it('keeps other removal failures as they are', async () => {
    callMock.mockRejectedValueOnce(new RuntimeClientError('runtime_error', 'worktree is dirty'))

    await main(['worktree', 'rm', '--environment', 'imac', '--worktree', 'id:r::/w'], '/tmp/repo')

    expect(printed()).toContain('worktree is dirty')
    expect(printed()).not.toContain('No worktree on imac')
  })
})
