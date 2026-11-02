import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { TERMINAL_METHODS } from './terminal'

function request(params: unknown): RpcRequest {
  return {
    id: 'focus-1',
    authToken: 'token',
    method: 'terminal.focus',
    params
  }
}

describe('terminal focus navigation authority', () => {
  it('denies implicit paired focus while preserving local and explicit host focus', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      focusTerminal: vi.fn().mockResolvedValue({
        handle: 'term-1',
        tabId: 'tab-1',
        worktreeId: 'wt-1'
      })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    await dispatcher.dispatchStreaming(request({ terminal: 'term-1' }), () => {}, {
      clientKind: 'mobile',
      pairedDeviceId: 'device-a'
    })
    await dispatcher.dispatchStreaming(
      request({ terminal: 'term-1', navigation: 'host' }),
      () => {},
      { clientKind: 'runtime', pairedDeviceId: 'device-b' }
    )
    await dispatcher.dispatchStreaming(request({ terminal: 'term-1' }), () => {}, {
      clientKind: 'runtime',
      pairedDeviceId: 'device-b'
    })
    await dispatcher.dispatch(request({ terminal: 'term-1' }))

    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(1, 'term-1', {
      navigateHost: false
    })
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(2, 'term-1', {
      navigateHost: true
    })
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(3, 'term-1', {
      navigateHost: false
    })
    expect(runtime.focusTerminal).toHaveBeenNthCalledWith(4, 'term-1', {
      navigateHost: true
    })
  })

  it('asks phones to open a terminal only for a host focus sent from another terminal', async () => {
    const focus = { handle: 'term_member', tabId: 'tab-1', worktreeId: 'wt-1', navigated: true }
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      focusTerminal: vi.fn().mockResolvedValue(focus),
      requestMobileTerminalOpen: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    await dispatcher.dispatch(
      request({ terminal: 'term_member', navigation: 'host', source: 'term_lead' })
    )
    await dispatcher.dispatch(request({ terminal: 'term_member', navigation: 'host' }))
    await dispatcher.dispatchStreaming(
      request({ terminal: 'term_member', source: 'term_lead' }),
      () => {},
      { clientKind: 'runtime', pairedDeviceId: 'device-b' }
    )
    await dispatcher.dispatchStreaming(
      request({ terminal: 'term_member', navigation: 'host', source: 'term_lead' }),
      () => {},
      { clientKind: 'mobile', pairedDeviceId: 'device-a' }
    )

    expect(runtime.requestMobileTerminalOpen).toHaveBeenCalledTimes(1)
    expect(runtime.requestMobileTerminalOpen).toHaveBeenCalledWith(focus, 'term_lead')
  })

  it('rejects client fanout targets that terminal focus cannot honor', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      focusTerminal: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      request({ terminal: 'term-1', navigation: 'clients' })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(runtime.focusTerminal).not.toHaveBeenCalled()
  })
})

describe('terminal split launch accounts', () => {
  it('forwards launch-scoped account ids to the runtime split', async () => {
    const splitTerminal = vi.fn().mockResolvedValue({
      handle: 'term-split',
      tabId: 'tab-1',
      paneRuntimeId: -1
    })
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      splitTerminal
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    await dispatcher.dispatch({
      id: 'split-1',
      authToken: 'token',
      method: 'terminal.split',
      params: {
        terminal: 'term-1',
        direction: 'vertical',
        command: 'codex',
        claudeAccountId: 'account-claude',
        codexAccountId: 'account-codex'
      }
    })

    expect(splitTerminal).toHaveBeenCalledWith('term-1', {
      direction: 'vertical',
      command: 'codex',
      env: undefined,
      telemetrySource: undefined,
      claudeAccountId: 'account-claude',
      codexAccountId: 'account-codex'
    })
  })
})

// Why: a remote member's handle resolves only on its host, so View asks this window to open it there (ORCA-839).
describe("revealing a paired host's terminal", () => {
  it('hands the host selector and handle to the runtime', async () => {
    const focus = { handle: 'term_839', environmentId: 'env-imac', host: 'imac', navigated: true }
    const runtime = {
      getRuntimeId: () => 'runtime-1',
      revealPairedTerminal: vi.fn().mockResolvedValue(focus)
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch({
      id: 'reveal-1',
      authToken: 'token',
      method: 'terminal.revealPaired',
      params: { terminal: 'term_839', on: 'imac' }
    })

    expect(runtime.revealPairedTerminal).toHaveBeenCalledWith('imac', 'term_839')
    expect(response).toMatchObject({ ok: true, result: { focus } })
  })
})
