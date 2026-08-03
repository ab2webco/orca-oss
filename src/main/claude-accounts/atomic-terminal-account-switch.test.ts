import { describe, expect, it, vi } from 'vitest'
import type {
  AtomicClaudeTerminalAccountSwitchPorts,
  ClaudeTerminalSwitchCapture
} from './atomic-terminal-account-switch'
import { runAtomicClaudeTerminalAccountSwitch } from './atomic-terminal-account-switch'
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
  prompts: string[]
  states: string[]
} {
  const calls: string[] = []
  const writes: string[] = []
  const prompts: string[] = []
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
      return { ok: true, label: 'target@example.com' }
    },
    prepareTranscript: async () => {
      calls.push('prepareTranscript')
      return { ok: true, copiedFileCount: 1 }
    },
    verifyResumeObservability: async () => {
      calls.push('verifyResumeObservability')
      return true
    },
    awaitSourceForeground: async () => {
      calls.push('awaitSourceForeground')
      return true
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
      return true
    },
    abort: async () => {
      calls.push('abort')
      return { ok: true, configDir: '/vault/account-source/auth' }
    },
    deliverContinuation: async ({ prompt }) => {
      calls.push('deliverContinuation')
      prompts.push(prompt)
      return true
    },
    onState: (event) => {
      states.push(event.state)
    },
    ...overrides
  }
  return { ports, calls, writes, prompts, states }
}

const REQUEST: ClaudeTerminalAccountSwitchRequest = {
  target: { kind: 'handle', terminal: 'orca-terminal-1' },
  targetAccountId: 'account-target'
}

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
      'verifyResumeObservability',
      'stopSource',
      'begin',
      'verifyResumeObservability',
      'writeLaunchCommand',
      'awaitExactSession',
      'commit',
      'deliverContinuation'
    ])
    expect(writes[0]).toContain(`'--resume' '${SESSION_ID}'`)
  })

  it('refuses before the interrupt when the source universe cannot report a resume', async () => {
    // ORCA-168: without the managed SessionStart hook, `awaitExactSession` can
    // only time out — including the rollback's own re-verification. Refusing
    // here keeps the invariant that a switch Orca cannot verify never stops the
    // agent, instead of burning the session for 90 s and reporting a false
    // rollback-failed on a healthy terminal.
    const { ports, calls } = buildPorts({ verifyResumeObservability: async () => false })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('preflighting')
    expect(result.failure?.reason).toBe('resume-verification-unavailable')
    expect(calls).toEqual(['capture', 'validateTarget', 'prepareTranscript'])
  })

  it('rolls back without launching the target when its prepared vault cannot report a resume', async () => {
    let checked = 0
    const { ports, calls, writes } = buildPorts({
      verifyResumeObservability: async () => {
        checked += 1
        return checked === 1
      }
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.failure?.reason).toBe('resume-verification-unavailable')
    // Nothing ran in the target universe, so the only write is the source's own
    // resume and there is no destination agent to interrupt.
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('/vault/account-source/auth')
    expect(calls).not.toContain('stopDestination')
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

  it('refuses to relaunch the source when the destination agent could not be stopped', async () => {
    const { ports, calls, writes } = buildPorts({
      awaitExactSession: async () => ({ ok: false, reason: 'foreground-timeout' }),
      stopDestination: async () => false
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)

    expect(result.state).toBe('rollback-failed')
    expect(result.failure?.reason).toBe('foreground-timeout')
    // Why: an unproven foreground would take the launch line as TUI input, and whatever
    // Claude eventually starts there owns the pane on a session nobody captured.
    expect(writes).toHaveLength(1)
    expect(calls.filter((call) => call === 'writeLaunchCommand')).toHaveLength(1)
    expect(result.recovery).toEqual({
      accountId: 'account-source',
      sessionId: SESSION_ID,
      terminal: 'orca-terminal-1',
      ptyId: 'pty-1',
      configDir: '/vault/account-source/auth'
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
  it('injects exactly one continuation prompt naming the target, only after a verified commit', async () => {
    const { ports, calls, prompts } = buildPorts()
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('committed')
    expect(result.continuationDelivered).toBe(true)
    expect(prompts).toEqual([
      'Account switched to target@example.com; continue where you left off.'
    ])
    // The truncated turn is only nudged once the resumed session is the same one.
    expect(calls.indexOf('deliverContinuation')).toBeGreaterThan(calls.indexOf('awaitExactSession'))
    expect(calls.indexOf('deliverContinuation')).toBeGreaterThan(calls.indexOf('commit'))
  })

  it('names the account id when the target account has no label', async () => {
    const { ports, prompts } = buildPorts({ validateTarget: async () => ({ ok: true }) })
    await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(prompts).toEqual(['Account switched to account-target; continue where you left off.'])
  })

  it('reports a continuation the terminal refused without failing the committed switch', async () => {
    const { ports } = buildPorts({ deliverContinuation: async () => false })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('committed')
    expect(result.failure).toBeUndefined()
    expect(result.continuationDelivered).toBe(false)
  })

  it('never injects a continuation prompt on a rolled-back switch', async () => {
    const { ports, calls, prompts } = buildPorts({ commit: async () => false })
    const result = await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(calls).not.toContain('deliverContinuation')
    expect(prompts).toEqual([])
  })
})

describe('runAtomicClaudeTerminalAccountSwitch agent self-switch', () => {
  const SELF_REQUEST: ClaudeTerminalAccountSwitchRequest = { ...REQUEST, selfSwitch: true }

  it('lets the caller tool exit and the agent reclaim the foreground before interrupting it', async () => {
    const { ports, calls } = buildPorts()
    const result = await runAtomicClaudeTerminalAccountSwitch(SELF_REQUEST, ports)
    expect(result.state).toBe('committed')
    // The Ctrl+C reaches the agent's whole foreground group, so it must not fire
    // while the invoking tool subprocess is still in it.
    expect(calls.indexOf('awaitSourceForeground')).toBeGreaterThan(
      calls.indexOf('prepareTranscript')
    )
    expect(calls.indexOf('awaitSourceForeground')).toBeLessThan(calls.indexOf('stopSource'))
  })

  it('leaves the terminal untouched when the caller never releases the agent', async () => {
    const { ports, calls, writes } = buildPorts({ awaitSourceForeground: async () => false })
    const result = await runAtomicClaudeTerminalAccountSwitch(SELF_REQUEST, ports)
    expect(result.failure?.reason).toBe('source-busy')
    expect(result.state).toBe('stopping-source')
    expect(calls).not.toContain('stopSource')
    expect(calls).not.toContain('begin')
    expect(writes).toEqual([])
  })

  it('does not wait on the foreground when the caller is not the switched terminal', async () => {
    const { ports, calls } = buildPorts()
    await runAtomicClaudeTerminalAccountSwitch(REQUEST, ports)
    expect(calls).not.toContain('awaitSourceForeground')
  })

  it('truncates the in-flight turn and resumes the same session with one continuation', async () => {
    const { ports, calls, writes, prompts } = buildPorts()
    const result = await runAtomicClaudeTerminalAccountSwitch(SELF_REQUEST, ports)
    expect(calls).toEqual([
      'capture',
      'validateTarget',
      'prepareTranscript',
      'verifyResumeObservability',
      'awaitSourceForeground',
      'stopSource',
      'begin',
      'verifyResumeObservability',
      'writeLaunchCommand',
      'awaitExactSession',
      'commit',
      'deliverContinuation'
    ])
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain(`'--resume' '${SESSION_ID}'`)
    expect(prompts).toEqual([
      'Account switched to target@example.com; continue where you left off.'
    ])
    expect(result.continuationDelivered).toBe(true)
  })

  it.each([
    ['a different session id', { observedSessionId: 'other-session' } as const],
    ['no session at all', {} as const]
  ])('rolls back to the original account when the resume reports %s', async (_label, extra) => {
    const { ports, calls, writes } = buildPorts({
      awaitSourceForeground: async () => true,
      awaitExactSession: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: 'session-mismatch', ...extra })
        .mockResolvedValue({ ok: true })
    })
    const result = await runAtomicClaudeTerminalAccountSwitch(SELF_REQUEST, ports)
    expect(result.state).toBe('rolled-back')
    expect(result.sourceAccountId).toBe('account-source')
    expect(calls).not.toContain('commit')
    expect(calls).not.toContain('deliverContinuation')
    expect(writes.at(-1)).toContain("export CLAUDE_CONFIG_DIR='/vault/account-source/auth'")
  })

  it('preserves --dangerously-skip-permissions exactly once in the destination and the rollback', async () => {
    const { ports, writes } = buildPorts({
      awaitExactSession: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: 'session-mismatch' })
        .mockResolvedValue({ ok: true })
    })
    await runAtomicClaudeTerminalAccountSwitch(SELF_REQUEST, ports)
    expect(writes).toHaveLength(2)
    for (const command of writes) {
      expect(command.match(/--dangerously-skip-permissions/g)).toHaveLength(1)
      expect(command).toContain(`'--resume' '${SESSION_ID}'`)
    }
  })

  // The invoking tool is dead from the Ctrl+C onwards: every one of these must
  // still land on a terminal state, and a failed rollback must say how to recover.
  it.each([
    [
      'a launch the terminal refuses',
      'rolled-back',
      { writeLaunchCommand: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true) }
    ],
    ['a binding commit that fails', 'rolled-back', { commit: async () => false }],
    [
      'a session that never comes back',
      'rollback-failed',
      { awaitExactSession: async () => ({ ok: false, reason: 'foreground-timeout' as const }) }
    ],
    [
      'a source that cannot be re-prepared',
      'rollback-failed',
      { commit: async () => false, abort: async () => ({ ok: false as const }) }
    ]
  ])('ends %s as %s without the caller', async (_label, expected, overrides) => {
    const { ports } = buildPorts(overrides as PortOverrides)
    const result = await runAtomicClaudeTerminalAccountSwitch(SELF_REQUEST, ports)
    expect(result.state).toBe(expected)
    expect(result.failure).toBeDefined()
    if (expected === 'rollback-failed') {
      expect(result.recovery).toMatchObject({
        accountId: 'account-source',
        sessionId: SESSION_ID,
        terminal: 'orca-terminal-1',
        ptyId: 'pty-1'
      })
    } else {
      expect(result.recovery).toBeUndefined()
    }
  })
})
