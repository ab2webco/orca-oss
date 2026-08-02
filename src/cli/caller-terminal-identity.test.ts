import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCallerTerminalIdentity } from './caller-terminal-identity'
import { RuntimeClientError, type RuntimeClient } from './runtime-client'

// Why: managed agent panes export these, so a bare process.env would make the
// assertions depend on who ran the suite (docs/reference/agent-verification-traps.md §5).
const CALLER_ENV_KEYS = [
  'ORCA_TERMINAL_HANDLE',
  'ORCA_PANE_KEY',
  'ORCA_AGENT_LAUNCH_TOKEN'
] as const

describe('resolveCallerTerminalIdentity', () => {
  const original = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of CALLER_ENV_KEYS) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of CALLER_ENV_KEYS) {
      const value = original.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  function buildClient(handlers: Record<string, (params: unknown) => unknown> = {}): {
    client: RuntimeClient
    calls: string[]
  } {
    const calls: string[] = []
    const call = vi.fn(async (method: string, params?: unknown) => {
      calls.push(method)
      const handler = handlers[method]
      if (!handler) {
        throw new RuntimeClientError('method_not_found', method)
      }
      return { result: handler(params) }
    })
    return { client: { call } as unknown as RuntimeClient, calls }
  }

  it('prefers an explicit terminal flag without probing the runtime', async () => {
    const { client, calls } = buildClient()
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map([['terminal', 'orca-terminal-7']]),
        client,
        env: {}
      })
    ).resolves.toEqual({ terminal: 'orca-terminal-7' })
    expect(calls).toEqual([])
  })

  it('carries the pane proof alongside an explicit handle', async () => {
    const { client } = buildClient()
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map([['terminal', 'orca-terminal-7']]),
        client,
        env: { ORCA_PANE_KEY: 'tab-1:leaf-1', ORCA_AGENT_LAUNCH_TOKEN: 'token-1' }
      })
    ).resolves.toEqual({
      terminal: 'orca-terminal-7',
      paneKey: 'tab-1:leaf-1',
      launchToken: 'token-1'
    })
  })

  it('uses a live ORCA_TERMINAL_HANDLE', async () => {
    const { client, calls } = buildClient({
      'terminal.show': () => ({ handle: 'orca-terminal-2' })
    })
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map(),
        client,
        env: { ORCA_TERMINAL_HANDLE: 'orca-terminal-2' }
      })
    ).resolves.toEqual({ terminal: 'orca-terminal-2' })
    expect(calls).toEqual(['terminal.show'])
  })

  it('remints a stale ORCA_TERMINAL_HANDLE from the pane key', async () => {
    const { client, calls } = buildClient({
      'terminal.show': () => {
        throw new RuntimeClientError('terminal_handle_stale', 'stale')
      },
      'terminal.resolvePane': () => ({ terminal: { handle: 'orca-terminal-9' } })
    })
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map(),
        client,
        env: { ORCA_TERMINAL_HANDLE: 'orca-terminal-old', ORCA_PANE_KEY: 'tab-1:leaf-1' }
      })
    ).resolves.toMatchObject({ terminal: 'orca-terminal-9', paneKey: 'tab-1:leaf-1' })
    expect(calls).toEqual(['terminal.show', 'terminal.resolvePane'])
  })

  it('resolves the pane key when no handle is exported', async () => {
    const { client, calls } = buildClient({
      'terminal.resolvePane': () => ({ terminal: { handle: 'orca-terminal-3' } })
    })
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map(),
        client,
        env: { ORCA_PANE_KEY: 'tab-2:leaf-2' }
      })
    ).resolves.toMatchObject({ terminal: 'orca-terminal-3' })
    expect(calls).toEqual(['terminal.resolvePane'])
  })

  it('never falls back to the focused terminal', async () => {
    const { client, calls } = buildClient({
      'terminal.resolveActive': () => ({ terminal: { handle: 'orca-terminal-focused' } })
    })
    await expect(
      resolveCallerTerminalIdentity({ flags: new Map(), client, env: {} })
    ).rejects.toMatchObject({ code: 'no_caller_terminal' })
    expect(calls).toEqual([])
  })

  it('fails closed when a stale pane key cannot be reminted', async () => {
    const { client } = buildClient({
      'terminal.resolvePane': () => {
        throw new RuntimeClientError('terminal_gone', 'gone')
      }
    })
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map(),
        client,
        env: { ORCA_PANE_KEY: 'tab-3:leaf-3' }
      })
    ).rejects.toMatchObject({ code: 'no_caller_terminal' })
  })

  it('rejects a valueless terminal flag instead of guessing', async () => {
    const { client } = buildClient()
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map([['terminal', '  ']]),
        client,
        env: { ORCA_TERMINAL_HANDLE: 'orca-terminal-2' }
      })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('propagates unrelated runtime errors instead of guessing a terminal', async () => {
    const { client } = buildClient({
      'terminal.show': () => {
        throw new RuntimeClientError('runtime_unavailable', 'down')
      }
    })
    await expect(
      resolveCallerTerminalIdentity({
        flags: new Map(),
        client,
        env: { ORCA_TERMINAL_HANDLE: 'orca-terminal-2' }
      })
    ).rejects.toMatchObject({ code: 'runtime_unavailable' })
  })
})
