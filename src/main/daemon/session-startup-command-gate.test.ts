import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Session } from './session'
import type { ShellReadyState } from './types'
import { createMockSubprocess, type MockSubprocess } from './session-mock-subprocess'

vi.mock('../pty-descendant-termination', () => ({
  killWithDescendantSweep: vi.fn()
}))

describe('Session', () => {
  let session: Session
  let subprocess: MockSubprocess

  beforeEach(() => {
    vi.useFakeTimers()
    subprocess = createMockSubprocess()
  })

  afterEach(() => {
    session?.dispose()
    vi.useRealTimers()
  })

  function createSession(opts: {
    shellReadySupported: boolean
    shellReadyTimeoutMs?: number
    startupCommandRequiresShellReady?: boolean
    onStartupCommandStateChange?: (state: 'withheld' | 'delivered') => void
  }): Session {
    session = new Session({
      sessionId: 'test-session',
      cols: 80,
      rows: 24,
      subprocess,
      shellReadySupported: opts.shellReadySupported,
      ...(opts.startupCommandRequiresShellReady ? { startupCommandRequiresShellReady: true } : {}),
      ...(opts.onStartupCommandStateChange
        ? { onStartupCommandStateChange: opts.onStartupCommandStateChange }
        : {}),
      ...(opts.shellReadyTimeoutMs !== undefined
        ? { shellReadyTimeoutMs: opts.shellReadyTimeoutMs }
        : {})
    })
    return session
  }

  describe('startup command gated on the shell-ready marker (ORCA-210)', () => {
    // The failure this encodes: oh-my-zsh asks "[oh-my-zsh] Would you like to
    // update? [Y/n]" from inside .zshrc and reads one key with `read -k`. No
    // prompt exists yet, so no marker fires. Writing "claude ..." then feeds
    // its `c` to that question and the shell runs `laude`, leaving a pane that
    // is connected, titled, and empty.
    const LAUNCH = "claude '--dangerously-skip-permissions'\n"

    it('does not write the launch command when the budget elapses without the marker', () => {
      createSession({
        shellReadySupported: true,
        startupCommandRequiresShellReady: true,
        shellReadyTimeoutMs: 100
      })
      session.writeStartupCommand(LAUNCH)

      subprocess.simulateData('[oh-my-zsh] Would you like to update? [Y/n] ')
      vi.advanceTimersByTime(100)

      expect(session.shellState).toBe('timed_out' satisfies ShellReadyState)
      expect(session.startupCommandState).toBe('withheld')
      expect(subprocess.written).toEqual([])
    })

    it('delivers the withheld launch command once the marker finally fires', () => {
      createSession({
        shellReadySupported: true,
        startupCommandRequiresShellReady: true,
        shellReadyTimeoutMs: 100
      })
      session.writeStartupCommand(LAUNCH)

      subprocess.simulateData('[oh-my-zsh] Would you like to update? [Y/n] ')
      vi.advanceTimersByTime(100)
      expect(subprocess.written).toEqual([])

      // The human answers; the shell reaches its prompt and zle-line-init fires.
      subprocess.simulateData('\r\n\x1b]777;orca-shell-ready\x07-> % ')
      vi.advanceTimersByTime(500)

      expect(session.shellState).toBe('ready' satisfies ShellReadyState)
      expect(session.startupCommandState).toBe('delivered')
      expect(subprocess.written).toEqual([LAUNCH])
    })

    it('releases user keystrokes at the budget so the prompt can be answered', () => {
      createSession({
        shellReadySupported: true,
        startupCommandRequiresShellReady: true,
        shellReadyTimeoutMs: 100
      })
      session.writeStartupCommand(LAUNCH)
      session.write('n')

      vi.advanceTimersByTime(100)

      expect(subprocess.written).toEqual(['n'])
    })

    it('reports withheld then delivered exactly once each', () => {
      const states: string[] = []
      createSession({
        shellReadySupported: true,
        startupCommandRequiresShellReady: true,
        shellReadyTimeoutMs: 100,
        onStartupCommandStateChange: (state) => states.push(state)
      })
      session.writeStartupCommand(LAUNCH)

      vi.advanceTimersByTime(100)
      subprocess.simulateData('\x1b]777;orca-shell-ready\x07-> % ')
      vi.advanceTimersByTime(500)

      expect(states).toEqual(['withheld', 'delivered'])
      expect(subprocess.written).toEqual([LAUNCH])
    })

    it('stays silent on the ordinary path where the marker beats the budget', () => {
      const states: string[] = []
      createSession({
        shellReadySupported: true,
        startupCommandRequiresShellReady: true,
        shellReadyTimeoutMs: 100,
        onStartupCommandStateChange: (state) => states.push(state)
      })
      session.writeStartupCommand(LAUNCH)

      subprocess.simulateData('\x1b]777;orca-shell-ready\x07-> % ')
      vi.advanceTimersByTime(500)

      expect(states).toEqual([])
      expect(session.startupCommandState).toBe('delivered')
      expect(subprocess.written).toEqual([LAUNCH])
    })

    it('keeps delivering at the budget when the marker is not required', () => {
      // Codex without a native draft flag runs on a 300ms budget whose expiry
      // IS the delivery trigger, not a failure. That lane must not change.
      createSession({ shellReadySupported: true, shellReadyTimeoutMs: 100 })
      session.writeStartupCommand(LAUNCH)

      vi.advanceTimersByTime(100)

      expect(session.startupCommandState).toBe('delivered')
      expect(subprocess.written).toEqual([LAUNCH])
    })

    it('writes immediately for a shell with no ready marker', () => {
      createSession({ shellReadySupported: false, startupCommandRequiresShellReady: true })
      session.writeStartupCommand(LAUNCH)

      expect(session.startupCommandState).toBe('delivered')
      expect(subprocess.written).toEqual([LAUNCH])
    })
  })
})
