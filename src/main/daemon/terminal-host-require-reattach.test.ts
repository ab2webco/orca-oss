import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from './session'
import { TerminalHost } from './terminal-host'

// Why its own file: terminal-host.test.ts sits at the max-lines budget; the
// require-reattach contract is a self-contained atomicity guarantee anyway.

vi.mock('../pty-descendant-termination', () => ({
  killWithDescendantSweep: vi.fn()
}))

function createMockSubprocess(): SubprocessHandle {
  let onExitCb: ((code: number) => void) | null = null
  return {
    pid: 99999,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      setTimeout(() => onExitCb?.(0), 5)
    }),
    forceKill: vi.fn(() => onExitCb?.(137)),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit(cb) {
      onExitCb = cb
    },
    dispose: vi.fn()
  } as SubprocessHandle
}

describe('TerminalHost required reattach', () => {
  let host: TerminalHost
  let spawnFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    spawnFn = vi.fn(() => createMockSubprocess())
    host = new TerminalHost({ spawnSubprocess: spawnFn as never })
  })

  afterEach(async () => {
    await host.dispose()
  })

  it('rejects a required reattach without spawning a replacement subprocess', async () => {
    await expect(
      host.createOrAttach({
        sessionId: 'missing-shared-session',
        requireReattach: true,
        cols: 80,
        rows: 24,
        streamClient: { onData: vi.fn(), onExit: vi.fn() }
      })
    ).rejects.toThrow('missing-shared-session')

    expect(spawnFn).not.toHaveBeenCalled()
  })
})
