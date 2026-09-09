// An I/O failure is not exit evidence: a throw from write or resize used to set
// the same `dead` flag an exit sets, which disabled kill, forceKill, signal and
// the producer's flow control. The session could never be terminated again.
import { describe, expect, it, vi } from 'vitest'
import type * as LocalPtyUtils from '../providers/local-pty-utils'

const {
  spawnMock,
  isPwshAvailableMock,
  validateWorkingDirectoryMock,
  resolveUnixShellPathMock,
  resolveAgentForegroundProcessMock
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  isPwshAvailableMock: vi.fn(),
  resolveUnixShellPathMock: vi.fn((shellPath: string) => shellPath),
  resolveAgentForegroundProcessMock: vi.fn(),
  validateWorkingDirectoryMock: vi.fn()
}))

vi.mock('node-pty', () => ({ spawn: spawnMock }))
vi.mock('../pwsh', () => ({ isPwshAvailable: isPwshAvailableMock }))

vi.mock('../providers/local-pty-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalPtyUtils>()
  return {
    ...actual,
    resolveUnixShellPath: resolveUnixShellPathMock,
    validateWorkingDirectory: validateWorkingDirectoryMock
  }
})

vi.mock('../providers/agent-foreground-process', () => ({
  resolveAgentForegroundProcessWithAvailability: async () => ({
    available: true,
    processName: null
  })
}))

vi.mock('../providers/windows-conpty-process-membership', () => ({
  readWindowsConptyProcessIds: () => Promise.resolve(new Set([12345]))
}))

import { createPtySubprocess } from './pty-subprocess'
import { mockPtyProcess, useDaemonPtySubprocessEnv } from './pty-subprocess-test-harness'

describe('createPtySubprocess I/O failure handling', () => {
  useDaemonPtySubprocessEnv({
    spawnMock,
    isPwshAvailableMock,
    resolveUnixShellPathMock,
    resolveAgentForegroundProcessMock,
    validateWorkingDirectoryMock
  })

  function spawnHandle(): {
    proc: ReturnType<typeof mockPtyProcess>
    handle: ReturnType<typeof createPtySubprocess>
  } {
    const proc = mockPtyProcess()
    spawnMock.mockReturnValue(proc)
    const handle = createPtySubprocess({
      sessionId: 'io-failure',
      cols: 80,
      rows: 24,
      env: { SHELL: '/bin/zsh' }
    })
    return { proc, handle }
  }

  // The whole point: a failed write must not cost the caller its ability to end
  // the session. Before this, one throw here made kill a no-op forever.
  it('still terminates the session after a write throws', () => {
    const { proc, handle } = spawnHandle()
    proc.write.mockImplementation(() => {
      throw new Error('write EIO')
    })

    expect(() => handle.write('ls\r')).not.toThrow()
    handle.kill()

    expect(proc.kill).toHaveBeenCalled()
  })

  it('still terminates the session after a resize throws', () => {
    const { proc, handle } = spawnHandle()
    proc.resize.mockImplementation(() => {
      throw new Error('resize EIO')
    })

    expect(() => handle.resize(120, 40)).not.toThrow()
    handle.kill()

    expect(proc.kill).toHaveBeenCalled()
  })

  // Why writes stop rather than retry: the fd is gone, so every further write
  // would throw again — the flag exists to stop hammering a dead handle, not to
  // stand in for exit.
  it('stops writing to a handle whose fd already failed', () => {
    const { proc, handle } = spawnHandle()
    proc.write.mockImplementationOnce(() => {
      throw new Error('write EIO')
    })

    handle.write('first\r')
    handle.write('second\r')

    expect(proc.write).toHaveBeenCalledTimes(1)
  })
})
