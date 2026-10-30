import { tmpdir } from 'node:os'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { mockPtySpawn, mockPtyInstance, mockCreateShellPromptReadinessProbe, mockSweep } =
  vi.hoisted(() => ({
    mockPtySpawn: vi.fn(),
    mockCreateShellPromptReadinessProbe: vi.fn(),
    mockSweep: vi.fn(async () => ({ status: 'swept', pids: [] })),
    mockPtyInstance: {
      pid: process.pid,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      clear: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    }
  }))

vi.mock('node-pty', () => ({
  spawn: mockPtySpawn
}))

vi.mock('../main/shell-prompt-readiness-probe', () => ({
  createShellPromptReadinessProbe: mockCreateShellPromptReadinessProbe
}))

vi.mock('../main/pty/ended-session-orphan-sweep', () => ({
  sweepEndedSessionOrphans: mockSweep
}))

import type { PtyHandler } from './pty-handler'
import {
  beginPtyHandlerTest,
  createPtyRequestHelpers,
  endPtyHandlerTest
} from './pty-handler-test-harness'
import type { MockDispatcher } from './pty-handler-test-harness'

describe('PtyHandler agent orphan sweep (ORCA-678)', () => {
  let dispatcher: MockDispatcher
  let handler: PtyHandler
  let originalPlatform: PropertyDescriptor | undefined
  let exit: ((evt: { exitCode: number }) => void) | undefined

  const { spawnPty } = createPtyRequestHelpers(() => dispatcher)

  beforeEach(() => {
    ;({ dispatcher, handler, originalPlatform } = beginPtyHandlerTest({
      mockPtySpawn,
      mockPtyInstance,
      mockCreateShellPromptReadinessProbe
    }))
    mockSweep.mockClear()
    exit = undefined
    mockPtySpawn.mockReturnValue({
      ...mockPtyInstance,
      onExit: vi.fn((cb: (evt: { exitCode: number }) => void) => {
        exit = cb
      })
    })
  })

  afterEach(async () => {
    await endPtyHandlerTest(handler, originalPlatform)
  })

  it.skipIf(process.platform === 'win32')(
    'sweeps the remote worktree once, when an agent PTY exits',
    async () => {
      const cwd = tmpdir()
      await spawnPty({ cwd, launchAgent: 'claude' })
      expect(mockSweep).not.toHaveBeenCalled()

      exit?.({ exitCode: 0 })
      exit?.({ exitCode: 0 })

      expect(mockSweep).toHaveBeenCalledTimes(1)
      expect(mockSweep).toHaveBeenCalledWith(cwd, expect.any(Number))
    }
  )

  it('does not sweep when a plain PTY exits', async () => {
    await spawnPty({ cwd: tmpdir() })
    exit?.({ exitCode: 0 })
    expect(mockSweep).not.toHaveBeenCalled()
  })
})
