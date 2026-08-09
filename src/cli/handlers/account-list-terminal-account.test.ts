import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_HANDLERS } from './account'
import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import type { ClaudeTerminalAccountReport } from '../../shared/types'

const PANE_HANDLE = 'orca-terminal-7'

function snapshot() {
  return {
    claude: {
      accounts: [
        { id: 'account-scloud', email: 'scloud@example.com' },
        { id: 'account-fabiana', email: 'fabiana@example.com' }
      ],
      // Why this shape is the whole point: the GLOBAL selection is the other
      // account, so any answer sourced from `active` names scloud (ORCA-175).
      activeAccountId: 'account-scloud',
      activeAccountIdsByRuntime: { host: 'account-scloud', wsl: {} }
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  }
}

describe('`account list` per-terminal Claude account', () => {
  const callMock = vi.fn()
  const client = { call: callMock } as unknown as RuntimeClient
  let logSpy: ReturnType<typeof vi.spyOn>
  const originalPaneEnv = {
    ORCA_TERMINAL_HANDLE: process.env.ORCA_TERMINAL_HANDLE,
    ORCA_PANE_KEY: process.env.ORCA_PANE_KEY
  }

  function context(flags: Map<string, string | boolean> = new Map()): HandlerContext {
    return { client, cwd: process.cwd(), flags, json: false, rawArgs: [] }
  }

  function respondWith(
    terminal: ClaudeTerminalAccountReport | (() => never),
    overrides: Record<string, unknown> = {}
  ): void {
    callMock.mockImplementation((method: string) => {
      if (method in overrides) {
        const value = overrides[method]
        return typeof value === 'function'
          ? (value as () => Promise<unknown>)()
          : Promise.resolve({ id: 't', ok: true, result: value, _meta: { runtimeId: 'r' } })
      }
      if (method === 'accounts.terminalClaudeAccount') {
        return typeof terminal === 'function'
          ? Promise.reject(new Error('runtime refused'))
          : Promise.resolve({ id: 't', ok: true, result: terminal, _meta: { runtimeId: 'r' } })
      }
      return Promise.resolve({
        id: 't',
        ok: true,
        result: method === 'terminal.show' ? { terminal: { handle: PANE_HANDLE } } : snapshot(),
        _meta: { runtimeId: 'r' }
      })
    })
  }

  beforeEach(() => {
    callMock.mockReset()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.ORCA_TERMINAL_HANDLE = PANE_HANDLE
    delete process.env.ORCA_PANE_KEY
  })

  afterEach(() => {
    logSpy.mockRestore()
    for (const [name, value] of Object.entries(originalPaneEnv)) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })

  function printed(): string {
    return logSpy.mock.calls.map((call) => String(call[0])).join('\n')
  }

  it('names the pane’s own account, not the globally active one', async () => {
    respondWith({
      terminal: PANE_HANDLE,
      ptyId: 'pty-9',
      ownership: {
        state: 'account',
        accountId: 'account-fabiana',
        email: 'fabiana@example.com',
        pinned: true
      }
    })

    await ACCOUNT_HANDLERS['account list'](context())

    const output = printed()
    expect(output).toContain('this terminal: fabiana@example.com  id account-fabiana')
    expect(output).toContain('pinned to this pane')
    // The globally active account must still be labelled active and must not be
    // marked as this terminal's.
    expect(output).toContain('scloud@example.com  id account-scloud  active')
    expect(output).toContain('fabiana@example.com  id account-fabiana  <- this terminal')
    expect(callMock).toHaveBeenCalledWith('accounts.terminalClaudeAccount', {
      terminal: PANE_HANDLE
    })
  })

  it('says a pane owns no managed account instead of naming one', async () => {
    respondWith({ terminal: PANE_HANDLE, ptyId: 'pty-9', ownership: { state: 'none' } })

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).toContain('this terminal: no managed Claude account')
    expect(printed()).not.toContain('<- this terminal')
  })

  it.each([
    ['ownership-unresolved', 'outlived a restart'],
    ['no-claude-binding', 'holds no Claude account binding'],
    ['remote-host', 'WSL distro or SSH host'],
    ['pane-unresolved', 'no live pane resolved']
  ])('reports unknown ownership (%s) with its reason', async (reason, message) => {
    respondWith({
      terminal: PANE_HANDLE,
      ptyId: null,
      ownership: { state: 'unknown', reason: reason as 'no-claude-binding' }
    })

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).toContain('this terminal: unknown —')
    expect(printed()).toContain(message)
    expect(printed()).toContain(`(${reason})`)
    expect(printed()).not.toContain('<- this terminal')
  })

  // ORCA-187: a pane that outlived a restart could lose the launch config the
  // switch relaunches from, and the only signal was the switch itself failing.
  it('says a pane is not switchable, and why, before anyone asks for a switch', async () => {
    respondWith({
      terminal: PANE_HANDLE,
      ptyId: 'pty-9',
      ownership: {
        state: 'account',
        accountId: 'account-fabiana',
        email: 'fabiana@example.com',
        pinned: true
      },
      switchReadiness: { state: 'unavailable', reason: 'missing-launch-config' }
    })

    await ACCOUNT_HANDLERS['account list'](context())

    const output = printed()
    expect(output).toContain('not switchable:')
    expect(output).toContain('no longer holds the command this pane was launched with')
    expect(output).toContain('(missing-launch-config)')
    // The account itself survived the restart and must still be named.
    expect(output).toContain('this terminal: fabiana@example.com  id account-fabiana')
  })

  it('stays quiet about switchability when the pane can be switched', async () => {
    respondWith({
      terminal: PANE_HANDLE,
      ptyId: 'pty-9',
      ownership: {
        state: 'account',
        accountId: 'account-fabiana',
        email: 'fabiana@example.com',
        pinned: true
      },
      switchReadiness: { state: 'ready' }
    })

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).not.toContain('not switchable')
  })

  it('says nothing about switchability when the runtime is too old to answer', async () => {
    respondWith({ terminal: PANE_HANDLE, ptyId: 'pty-9', ownership: { state: 'none' } })

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).not.toContain('not switchable')
  })

  it('still prints the roster when the pane lookup fails', async () => {
    // Why: `account list` is the safe cached path for scripted callers. A pane it
    // cannot read must not take the roster down with it.
    respondWith(() => {
      throw new Error('unused')
    })

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).toContain('this terminal: unknown — the runtime could not answer')
    expect(printed()).toContain('(lookup-failed)')
    expect(printed()).toContain('scloud@example.com  id account-scloud  active')
  })

  it('degrades to unknown when the caller cannot prove a pane of its own', async () => {
    delete process.env.ORCA_TERMINAL_HANDLE
    respondWith({ terminal: null, ptyId: null, ownership: { state: 'none' } })

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).toContain('(no-caller-terminal)')
    expect(callMock).not.toHaveBeenCalledWith('accounts.terminalClaudeAccount', expect.anything())
  })

  it('survives an arbitrary failure while validating the caller’s handle', async () => {
    // isLiveTerminalHandle rethrows anything that is not a stale-handle code, so
    // an unrelated runtime error here used to be able to fail the whole command.
    respondWith(
      { terminal: PANE_HANDLE, ptyId: 'pty-9', ownership: { state: 'none' } },
      {
        'terminal.show': () => Promise.reject(new RuntimeClientError('internal', 'graph not ready'))
      }
    )

    await ACCOUNT_HANDLERS['account list'](context())

    expect(printed()).toContain('(no-caller-terminal)')
    expect(printed()).toContain('scloud@example.com  id account-scloud  active')
  })

  it('asks about the pane named by --terminal', async () => {
    respondWith({
      terminal: 'orca-terminal-99',
      ptyId: 'pty-1',
      ownership: {
        state: 'account',
        accountId: 'account-scloud',
        email: 'scloud@example.com',
        pinned: false
      }
    })

    await ACCOUNT_HANDLERS['account list'](
      context(new Map<string, string | boolean>([['terminal', 'orca-terminal-99']]))
    )

    expect(callMock).toHaveBeenCalledWith('accounts.terminalClaudeAccount', {
      terminal: 'orca-terminal-99'
    })
    expect(printed()).toContain("Orca's shared runtime auth")
    expect(printed()).toContain('[orca-terminal-99]')
  })

  it('emits the terminal block in JSON so an agent never has to read `active`', async () => {
    respondWith({
      terminal: PANE_HANDLE,
      ptyId: 'pty-9',
      ownership: {
        state: 'account',
        accountId: 'account-fabiana',
        email: 'fabiana@example.com',
        pinned: true
      }
    })

    await ACCOUNT_HANDLERS['account list']({ ...context(), json: true })

    const payload = JSON.parse(printed()) as {
      result: { terminal: ClaudeTerminalAccountReport }
    }
    expect(payload.result.terminal).toEqual({
      terminal: PANE_HANDLE,
      ptyId: 'pty-9',
      ownership: {
        state: 'account',
        accountId: 'account-fabiana',
        email: 'fabiana@example.com',
        pinned: true
      }
    })
  })
})
