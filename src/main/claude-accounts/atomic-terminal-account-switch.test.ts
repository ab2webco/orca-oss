import { describe, expect, it, vi } from 'vitest'
import type {
  AtomicClaudeTerminalAccountSwitchPorts,
  ClaudeTerminalSwitchCapture
} from './atomic-terminal-account-switch'
import {
  buildClaudeTerminalSwitchLaunchCommand,
  runAtomicClaudeTerminalAccountSwitch
} from './atomic-terminal-account-switch'
import type { ClaudeTerminalAccountSwitchRequest } from '../../shared/claude-terminal-account-switch'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'

function buildCapture(
  overrides: Partial<ClaudeTerminalSwitchCapture> = {}
): ClaudeTerminalSwitchCapture {
  return {
    operationId: 'op-1',
    terminal: 'orca-terminal-1',
    ptyId: 'pty-1',
    paneKey: 'tab-1:leaf-1',
    sourceAccountId: 'account-source',
    targetAccountId: 'account-target',
    runtime: 'host',
    wslDistro: null,
    cwd: '/repo/worktree',
    sessionId: SESSION_ID,
    launchConfig: {
      agentCommand: 'claude --dangerously-skip-permissions',
      agentArgs: '--dangerously-skip-permissions',
      agentEnv: { FOO: 'bar' }
    },
    platform: 'darwin',
    shell: 'posix',
    capturedAt: 1_000,
    ...overrides
  }
}

type PortOverrides = Partial<AtomicClaudeTerminalAccountSwitchPorts>

function buildPorts(overrides: PortOverrides = {}): {
  ports: AtomicClaudeTerminalAccountSwitchPorts
  calls: string[]
  writes: string[]
  states: string[]
} {
  const calls: string[] = []
  const writes: string[] = []
  const states: string[] = []
  let clock = 5_000
  const ports: AtomicClaudeTerminalAccountSwitchPorts = {
    now: () => ++clock,
    capture: async () => {
      calls.push('capture')
      return { ok: true, capture: buildCapture() }
    },
    validateTarget: async () => {
      calls.push('validateTarget')
      return { ok: true }
    },
    prepareTranscript: async () => {
      calls.push('prepareTranscript')
      return { ok: true, copiedFileCount: 1 }
    },
    stopSource: async () => {
      calls.push('stopSource')
      return true
    },
    begin: async () => {
      calls.push('begin')
      return {
        ok: true,
        configDir: '/vault/account-target/auth',
        reservationId: 'res-1',
        shell: 'posix'
      }
    },
    writeLaunchCommand: async ({ command }) => {
      calls.push('writeLaunchCommand')
      writes.push(command)
      return true
    },
    awaitExactSession: async () => {
      calls.push('awaitExactSession')
      return { ok: true }
    },
    commit: async () => {
      calls.push('commit')
      return true
    },
    stopDestination: async () => {
      calls.push('stopDestination')
    },
    abort: async () => {
      calls.push('abort')
      return { ok: true, configDir: '/vault/account-source/auth' }
    },
    deliverContinuation: async () => {
      calls.push('deliverContinuation')
      return true
    },
    onState: (event) => {
      states.push(event.state)
    },
    ...overrides
  }
  return { ports, calls, writes, states }
}

const REQUEST: ClaudeTerminalAccountSwitchRequest = {
  target: { kind: 'handle', terminal: 'orca-terminal-1' },
  targetAccountId: 'account-target'
}

describe('buildClaudeTerminalSwitchLaunchCommand', () => {
  it('preserves the captured argv, including --dangerously-skip-permissions, exactly once', () => {
    const built = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: SESSION_ID,
      launchConfig: {
        agentCommand: 'claude --dangerously-skip-permissions',
        agentArgs: '--dangerously-skip-permissions',
        agentEnv: {}
      },
      shell: 'posix',
      platform: 'darwin',
      configDir: '/vault/account-target/auth'
    })
    expect(built.ok).toBe(true)
    const command = built.ok ? built.command : ''
    expect(command.match(/--dangerously-skip-permissions/g)).toHaveLength(1)
    expect(command).toContain(`'--resume' '${SESSION_ID}'`)
    expect(command).toContain("export CLAUDE_CONFIG_DIR='/vault/account-target/auth'")
  })

  it('refuses a launch configuration with no recorded agent command instead of guessing defaults', () => {
    const built = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: SESSION_ID,
      launchConfig: { agentArgs: '', agentEnv: {} },
      shell: 'posix',
      platform: 'darwin',
      configDir: '/vault/account-target/auth'
    })
    expect(built).toEqual({ ok: false, reason: 'missing-launch-config' })
  })

  it('omits the config-dir export when the shell already exports the universe', () => {
    const built = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: SESSION_ID,
      launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} },
      shell: 'posix',
      platform: 'darwin',
      configDir: null
    })
    expect(built.ok && built.command).toBe(`claude '--resume' '${SESSION_ID}'`)
  })
})

describe('runAtomicClaudeTerminalAccountSwitch preflight atomicity', () => {
  it('commits and reports the transcript copy count on the happy path', async () => {
    const { ports, calls, writes } = buildPorts()
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('committed')
    expect(result.failure).toBeUndefined()
    expect(result.transcriptCopiedFileCount).toBe(1)
    expect(calls).toEqual([
      'capture',
      'validateTarget',
      'prepareTranscript',
      'stopSource',
      'begin',
      'writeLaunchCommand',
      'awaitExactSession',
      'commit'
    ])
    expect(writes[0]).toContain(`'--resume' '${SESSION_ID}'`)
  })

  it('treats a linked shared transcript store as success with zero copies', async () => {
    const { ports } = buildPorts({
      prepareTranscript: async () => ({ ok: true, copiedFileCount: 0 })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('committed')
    expect(result.transcriptCopiedFileCount).toBe(0)
  })

  it.each([
    ['target-not-found' as const],
    ['target-unsupported-auth' as const],
    ['target-auth-invalid' as const],
    ['unsupported-runtime' as const]
  ])('refuses %s before stopping the source', async (reason) => {
    const { ports, calls } = buildPorts({
      validateTarget: async () => ({ ok: false, reason })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.reason).toBe(reason)
    expect(result.state).toBe('preflighting')
    expect(calls).not.toContain('stopSource')
    expect(calls).not.toContain('begin')
  })

  it('refuses a transcript that cannot be made reachable before stopping the source', async () => {
    const { ports, calls } = buildPorts({
      prepareTranscript: async () => ({ ok: false, reason: 'transcript-unavailable' })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.reason).toBe('transcript-unavailable')
    expect(calls).not.toContain('stopSource')
  })

  it('refuses an untrusted launch configuration before Ctrl+C', async () => {
    const { ports, calls } = buildPorts({
      capture: async () => ({
        ok: true,
        capture: buildCapture({ launchConfig: { agentArgs: '', agentEnv: {} } })
      })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.reason).toBe('missing-launch-config')
    expect(calls).not.toContain('stopSource')
    expect(calls).not.toContain('begin')
  })

  it('refuses a switch to the account the terminal already runs on', async () => {
    const { ports, calls } = buildPorts({
      capture: async () => ({
        ok: true,
        capture: buildCapture({ sourceAccountId: 'account-target' })
      })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.reason).toBe('target-already-active')
    expect(calls).toEqual([])
  })

  it('surfaces capture failures without an operation id or terminal mutation', async () => {
    const { ports, calls } = buildPorts({
      capture: async () => ({ ok: false, reason: 'missing-session' })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.reason).toBe('missing-session')
    expect(result.operationId).toBe('')
    expect(result.terminal).toBe('orca-terminal-1')
    expect(calls).toEqual([])
  })

  it('leaves the source agent running when it refuses to stop', async () => {
    const { ports, calls } = buildPorts({ stopSource: async () => false })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.reason).toBe('source-stop-failed')
    expect(result.state).toBe('stopping-source')
    expect(calls).not.toContain('begin')
    expect(calls).not.toContain('writeLaunchCommand')
  })
})

describe('runAtomicClaudeTerminalAccountSwitch resume verification', () => {
  it('rolls back when the resumed agent reports a different session id', async () => {
    const { ports, calls, writes } = buildPorts({
      awaitExactSession: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: 'session-mismatch',
          observedSessionId: 'other-session'
        })
        .mockResolvedValue({ ok: true })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.failure).toMatchObject({
      reason: 'session-mismatch',
      observedSessionId: 'other-session'
    })
    // The foreground-only check this replaces would have committed here.
    expect(calls).not.toContain('commit')
    expect(calls).toContain('stopDestination')
    expect(calls).toContain('abort')
    // The restore relaunches into the source universe, not the destination's.
    expect(writes.at(-1)).toContain("export CLAUDE_CONFIG_DIR='/vault/account-source/auth'")
    expect(writes.at(-1)).toContain(`'--resume' '${SESSION_ID}'`)
  })

  it('rolls back when no fresh observation arrives in time', async () => {
    const { ports, calls } = buildPorts({
      awaitExactSession: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: 'foreground-timeout' })
        .mockResolvedValue({ ok: true })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.failure?.reason).toBe('foreground-timeout')
    expect(calls).not.toContain('commit')
  })

  it('verifies the destination only against observations made after the launch write', async () => {
    const observedAfter: number[] = []
    const { ports } = buildPorts({
      awaitExactSession: async (args) => {
        observedAfter.push(args.observedAfter)
        return { ok: true }
      }
    })
    await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(observedAfter).toHaveLength(1)
    // now() is read once, immediately before the write; a pre-launch row cannot satisfy it.
    expect(observedAfter[0]).toBe(5_001)
  })
})

describe('runAtomicClaudeTerminalAccountSwitch rollback', () => {
  it('restores the source without a config-dir export when begin never swapped it', async () => {
    const { ports, calls, writes } = buildPorts({
      begin: async () => ({ ok: false, reason: 'concurrent' })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.failure?.reason).toBe('concurrent')
    expect(calls).not.toContain('abort')
    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toContain('CLAUDE_CONFIG_DIR')
    expect(writes[0]).toBe(`claude --dangerously-skip-permissions '--resume' '${SESSION_ID}'`)
  })

  it('names the terminal holding a blocked target account', async () => {
    const { ports } = buildPorts({
      begin: async () => ({
        ok: false,
        reason: 'prepare-failed',
        blockingTerminal: 'orca-terminal-9'
      })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.failure?.blockingTerminal).toBe('orca-terminal-9')
  })

  it('rolls back a failed commit', async () => {
    const { ports, calls } = buildPorts({ commit: async () => false })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.failure?.reason).toBe('commit-failed')
    expect(calls.filter((call) => call === 'abort')).toHaveLength(1)
  })

  it('rolls back a launch command the terminal refuses', async () => {
    const write = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const { ports } = buildPorts({ writeLaunchCommand: write })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.failure?.reason).toBe('launch-write-failed')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('reports rollback-failed with recovery context when the source cannot be re-prepared', async () => {
    const { ports } = buildPorts({
      awaitExactSession: async () => ({ ok: false, reason: 'session-mismatch' }),
      abort: async () => ({ ok: false })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rollback-failed')
    expect(result.failure?.reason).toBe('session-mismatch')
    expect(result.recovery).toEqual({
      accountId: 'account-source',
      sessionId: SESSION_ID,
      terminal: 'orca-terminal-1',
      ptyId: 'pty-1'
    })
  })

  it('reports rollback-failed when the restored source session cannot be re-verified', async () => {
    const { ports, states } = buildPorts({
      awaitExactSession: async () => ({ ok: false, reason: 'session-mismatch' })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rollback-failed')
    expect(result.recovery?.configDir).toBe('/vault/account-source/auth')
    expect(states).toEqual([
      'stopping-source',
      'launching-target',
      'verifying',
      'rolling-back',
      'rollback-failed'
    ])
  })
})

describe('runAtomicClaudeTerminalAccountSwitch continuation', () => {
  it('injects the continuation prompt once, only after a verified commit', async () => {
    const deliver = vi.fn().mockResolvedValue(true)
    const { ports } = buildPorts({ deliverContinuation: deliver })
    const result = await runAtomicClaudeTerminalAccountSwitch(
      {
        ...REQUEST,
        continuationPrompt: 'Account switched to target; continue where you left off.'
      },
      ports
    )
    expect(result.state).toBe('committed')
    expect(result.continuationDelivered).toBe(true)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0]?.[0].prompt).toBe(
      'Account switched to target; continue where you left off.'
    )
  })

  it('never injects a continuation prompt on a rolled-back switch', async () => {
    const deliver = vi.fn().mockResolvedValue(true)
    const { ports } = buildPorts({
      deliverContinuation: deliver,
      commit: async () => false
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(
      { ...REQUEST, continuationPrompt: 'continue' },
      ports
    )
    expect(result.state).toBe('rolled-back')
    expect(deliver).not.toHaveBeenCalled()
  })
})
