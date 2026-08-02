import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import type { HandlerContext } from '../dispatch'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

describe('orca account switch', () => {
  const CALLER_ENV_KEYS = [
    'ORCA_TERMINAL_HANDLE',
    'ORCA_PANE_KEY',
    'ORCA_AGENT_LAUNCH_TOKEN'
  ] as const
  const originalEnv = new Map<string, string | undefined>()
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    for (const key of CALLER_ENV_KEYS) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const key of CALLER_ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    logSpy.mockRestore()
  })

  type SwitchResultOverrides = Record<string, unknown>

  function buildSwitchClient(
    options: {
      switchResult?: SwitchResultOverrides
      acceptance?: Record<string, unknown>
      /** Consumed one per `accounts.claudeTerminalSwitchStatus` poll. */
      statusResults?: SwitchResultOverrides[]
    } = {}
  ): {
    client: RuntimeClient
    calls: { method: string; params?: unknown }[]
  } {
    const calls: { method: string; params?: unknown }[] = []
    const pendingStatuses = [...(options.statusResults ?? [])]
    const call = vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (method === 'accounts.claudeTerminalSwitchStatus') {
        const next = pendingStatuses.shift()
        if (!next) {
          throw new RuntimeClientError('invalid_argument', 'unexpected status poll')
        }
        return {
          result: {
            result: {
              operationId: 'op-7',
              terminal: 'orca-terminal-5',
              ptyId: 'pty-5',
              sourceAccountId: 'acct-1',
              targetAccountId: 'acct-2',
              sessionId: 'session-5',
              ...next
            }
          }
        }
      }
      if (method === 'accounts.snapshot') {
        return {
          result: {
            claude: {
              accounts: [
                { id: 'acct-1', email: 'one@example.com' },
                { id: 'acct-2', email: 'two@example.com' },
                { id: 'acct-3', email: 'dup@example.com' },
                { id: 'acct-4', email: 'dup@example.com' }
              ],
              activeAccountId: 'acct-1'
            },
            codex: { accounts: [], activeAccountId: null }
          }
        }
      }
      if (method === 'accounts.switchClaudeTerminal') {
        return {
          result: {
            accepted: true,
            acceptance: { operationId: 'op-7', selfSwitch: false, ...options.acceptance },
            result: {
              operationId: 'op-7',
              state: 'committed',
              terminal: 'orca-terminal-5',
              ptyId: 'pty-5',
              sourceAccountId: 'acct-1',
              targetAccountId: 'acct-2',
              sessionId: 'session-5',
              transcriptCopiedFileCount: 0,
              ...options.switchResult
            }
          }
        }
      }
      throw new RuntimeClientError('method_not_found', method)
    })
    return { client: { call } as unknown as RuntimeClient, calls }
  }

  function switchContext(
    client: RuntimeClient,
    flags: [string, string | boolean][],
    json = false
  ): HandlerContext {
    return { client, cwd: process.cwd(), flags: new Map(flags), json, rawArgs: [] }
  }

  it('switches an explicitly named terminal without a provider usage refresh', async () => {
    const { client, calls } = buildSwitchClient()
    await ACCOUNT_HANDLERS['account switch']!(
      switchContext(client, [
        ['to', 'two@example.com'],
        ['terminal', 'orca-terminal-5']
      ])
    )
    expect(calls.map((entry) => entry.method)).toEqual([
      'accounts.snapshot',
      'accounts.switchClaudeTerminal'
    ])
    expect(calls[1]?.params).toEqual({
      terminal: 'orca-terminal-5',
      targetAccountId: 'acct-2',
      awaitMs: 0
    })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('State:     committed')
  })

  it('resolves the caller pane and forwards its launch-token proof', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'orca-terminal-5'
    process.env.ORCA_PANE_KEY = 'tab-1:leaf-1'
    process.env.ORCA_AGENT_LAUNCH_TOKEN = 'token-1'
    const { client, calls } = buildSwitchClient()
    const call = client.call as unknown as ReturnType<typeof vi.fn>
    call.mockImplementation(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (method === 'terminal.show') {
        return { result: { handle: 'orca-terminal-5' } }
      }
      if (method === 'accounts.snapshot') {
        return {
          result: {
            claude: {
              accounts: [{ id: 'acct-2', email: 'two@example.com' }],
              activeAccountId: null
            },
            codex: { accounts: [], activeAccountId: null }
          }
        }
      }
      return {
        result: {
          accepted: true,
          acceptance: { operationId: 'op-8' },
          result: {
            operationId: 'op-8',
            state: 'committed',
            terminal: 'orca-terminal-5',
            ptyId: 'pty-5',
            sourceAccountId: 'acct-1',
            targetAccountId: 'acct-2',
            sessionId: 'session-5'
          }
        }
      }
    })
    await ACCOUNT_HANDLERS['account switch']!(switchContext(client, [['to', 'acct-2']]))
    expect(calls.map((entry) => entry.method)).toEqual([
      'terminal.show',
      'accounts.snapshot',
      'accounts.switchClaudeTerminal'
    ])
    expect(calls.at(-1)?.params).toEqual({
      terminal: 'orca-terminal-5',
      paneKey: 'tab-1:leaf-1',
      launchToken: 'token-1',
      targetAccountId: 'acct-2',
      awaitMs: 0
    })
  })

  it('refuses to guess a terminal when the caller cannot prove one', async () => {
    const { client, calls } = buildSwitchClient()
    await expect(
      ACCOUNT_HANDLERS['account switch']!(switchContext(client, [['to', 'acct-2']]))
    ).rejects.toMatchObject({ code: 'no_caller_terminal' })
    expect(calls).toEqual([])
  })

  it('rejects an ambiguous account selector before touching the terminal', async () => {
    const { client, calls } = buildSwitchClient()
    await expect(
      ACCOUNT_HANDLERS['account switch']!(
        switchContext(client, [
          ['to', 'dup@example.com'],
          ['terminal', 'orca-terminal-5']
        ])
      )
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(calls.map((entry) => entry.method)).toEqual(['accounts.snapshot'])
  })

  it('rejects an unknown account selector', async () => {
    const { client } = buildSwitchClient()
    await expect(
      ACCOUNT_HANDLERS['account switch']!(
        switchContext(client, [
          ['to', 'nobody@example.com'],
          ['terminal', 'orca-terminal-5']
        ])
      )
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('reports a rolled-back switch as a failure that names the operation', async () => {
    const { client } = buildSwitchClient({
      switchResult: {
        state: 'rolled-back',
        failure: {
          reason: 'session-mismatch',
          message:
            'The resumed agent reported a different session, so Orca rolled the switch back.',
          observedSessionId: 'other-session'
        }
      }
    })
    await expect(
      ACCOUNT_HANDLERS['account switch']!(
        switchContext(client, [
          ['to', 'acct-2'],
          ['terminal', 'orca-terminal-5']
        ])
      )
    ).rejects.toMatchObject({
      code: 'claude_terminal_switch_session_mismatch',
      message: expect.stringContaining('operation op-7')
    })
  })

  it('reports an accepted self-switch instead of polling its own dying terminal', async () => {
    // A self-switching agent is told the outcome before the interrupt reaches
    // its own tool call, so a non-terminal state is a success, not a failure —
    // and polling here would hold the foreground the runtime is waiting to get
    // back, turning the switch into `source-busy`.
    const { client, calls } = buildSwitchClient({
      acceptance: { selfSwitch: true },
      switchResult: { state: 'stopping-source', transcriptCopiedFileCount: undefined }
    })
    await ACCOUNT_HANDLERS['account switch']!(
      switchContext(client, [
        ['to', 'acct-2'],
        ['terminal', 'orca-terminal-5']
      ])
    )
    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toContain('State:     stopping-source')
    expect(printed).toContain('Operation: op-7')
    expect(printed).toMatch(/keeps running in this terminal/i)
    expect(calls.map((entry) => entry.method)).not.toContain('accounts.claudeTerminalSwitchStatus')
  })

  it('polls the accepted operation to its terminal state instead of holding the socket', async () => {
    // ORCA-168: the runtime held the response for the whole transaction, so a
    // real switch outlived the socket and the CLI never learned the operation
    // id. Acceptance now comes back immediately and the result is polled.
    const { client, calls } = buildSwitchClient({
      switchResult: { state: 'preflighting', transcriptCopiedFileCount: undefined },
      statusResults: [
        { state: 'verifying' },
        { state: 'committed', transcriptCopiedFileCount: 0, continuationDelivered: true }
      ]
    })
    await ACCOUNT_HANDLERS['account switch']!(
      switchContext(client, [
        ['to', 'acct-2'],
        ['terminal', 'orca-terminal-5']
      ])
    )
    expect(calls.filter((entry) => entry.method === 'accounts.claudeTerminalSwitchStatus')).toEqual(
      [
        { method: 'accounts.claudeTerminalSwitchStatus', params: { operationId: 'op-7' } },
        { method: 'accounts.claudeTerminalSwitchStatus', params: { operationId: 'op-7' } }
      ]
    )
    expect(logSpy.mock.calls.flat().join('\n')).toContain('State:     committed')
  })

  it('fails the command on a polled rollback and still names the operation', async () => {
    const { client } = buildSwitchClient({
      switchResult: { state: 'preflighting', transcriptCopiedFileCount: undefined },
      statusResults: [
        {
          state: 'rolled-back',
          failure: { reason: 'foreground-timeout', message: 'The resumed agent did not take over.' }
        }
      ]
    })
    await expect(
      ACCOUNT_HANDLERS['account switch']!(
        switchContext(client, [
          ['to', 'acct-2'],
          ['terminal', 'orca-terminal-5']
        ])
      )
    ).rejects.toMatchObject({
      code: 'claude_terminal_switch_foreground_timeout',
      message: expect.stringContaining('operation op-7')
    })
  })

  it('targets the terminal named on the command line while still proving the caller', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'orca-terminal-5'
    process.env.ORCA_PANE_KEY = 'tab-1:leaf-1'
    process.env.ORCA_AGENT_LAUNCH_TOKEN = 'token-1'
    const { client, calls } = buildSwitchClient()
    await ACCOUNT_HANDLERS['account switch']!(
      switchContext(client, [
        ['to', 'acct-2'],
        ['terminal', 'orca-terminal-9']
      ])
    )
    expect(calls.at(-1)?.params).toEqual({
      terminal: 'orca-terminal-9',
      paneKey: 'tab-1:leaf-1',
      launchToken: 'token-1',
      targetAccountId: 'acct-2',
      awaitMs: 0
    })
  })

  it('surfaces the manual recovery context of a rollback that failed', async () => {
    const { client } = buildSwitchClient({
      switchResult: {
        state: 'rollback-failed',
        failure: {
          reason: 'session-mismatch',
          message: 'The resumed agent reported a different session.'
        },
        recovery: {
          accountId: 'acct-1',
          sessionId: 'session-5',
          configDir: '/vault/acct-1/auth',
          terminal: 'orca-terminal-5',
          ptyId: 'pty-5'
        }
      }
    })
    await expect(
      ACCOUNT_HANDLERS['account switch']!(
        switchContext(client, [
          ['to', 'acct-2'],
          ['terminal', 'orca-terminal-5']
        ])
      )
    ).rejects.toMatchObject({
      code: 'claude_terminal_switch_session_mismatch',
      // The caller may already be dead; the recovery data must survive in the error.
      message: expect.stringContaining('session-5')
    })
  })

  it('rejects --environment instead of retargeting the switch', async () => {
    const { client, calls } = buildSwitchClient()
    await expect(
      ACCOUNT_HANDLERS['account switch']!(
        switchContext(client, [
          ['to', 'acct-2'],
          ['environment', 'homelab']
        ])
      )
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(calls).toEqual([])
  })
})
