import { describe, expect, it, vi } from 'vitest'
import {
  beginHostAccountLogin,
  cancelHostAccountLogin,
  completeHostAccountLogin
} from './runtime-host-login-client'

const callRuntimeRpc = vi.hoisted(() => vi.fn())

vi.mock('./runtime-rpc-client', () => ({
  callRuntimeRpc,
  getActiveRuntimeTarget: (settings: { activeRuntimeEnvironmentId?: string | null } | null) =>
    settings?.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: settings.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

const remote = { activeRuntimeEnvironmentId: 'env-1' } as never
const local = { activeRuntimeEnvironmentId: null } as never

vi.mock('@/lib/web-client-location', () => ({
  isWebClientLocation: () => webClient.value
}))

const webClient = { value: false }

describe('runtime host login client', () => {
  it('routes the sign-in to the environment that owns the accounts', async () => {
    callRuntimeRpc.mockResolvedValueOnce({ sessionId: 's-1', url: 'https://example.test/auth' })

    await expect(beginHostAccountLogin(remote, 'codex')).resolves.toMatchObject({
      sessionId: 's-1'
    })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'accounts.beginHostLogin',
      { agent: 'codex' },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('sends the code the user copied back to the same session', async () => {
    callRuntimeRpc.mockResolvedValueOnce({ accounts: [] })

    await completeHostAccountLogin(remote, 's-1', 'ABCD-1234')

    expect(callRuntimeRpc).toHaveBeenLastCalledWith(
      expect.anything(),
      'accounts.completeHostLogin',
      { sessionId: 's-1', code: 'ABCD-1234' },
      expect.anything()
    )
  })

  it('carries a null code for the device-auth flow that needs none', async () => {
    callRuntimeRpc.mockResolvedValueOnce({ accounts: [] })

    await completeHostAccountLogin(remote, 's-2', null)

    expect(callRuntimeRpc).toHaveBeenLastCalledWith(
      expect.anything(),
      'accounts.completeHostLogin',
      { sessionId: 's-2', code: null },
      expect.anything()
    )
  })

  // Why the web client passes with a local target: the page is served by the
  // runtime that owns the accounts, so "local" there means that server. Its
  // accounts shim resolves an empty roster for `add`, so without this lane the
  // button looked like it did nothing.
  it('uses the serving runtime when it is the web client', async () => {
    webClient.value = true
    callRuntimeRpc.mockClear().mockResolvedValueOnce({ sessionId: 's-web', url: 'https://x.test' })

    await expect(beginHostAccountLogin(local, 'claude')).resolves.toMatchObject({
      sessionId: 's-web'
    })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'accounts.beginHostLogin',
      { agent: 'claude' },
      expect.anything()
    )
    webClient.value = false
  })

  it.each([
    ['begin', () => beginHostAccountLogin(local, 'claude')],
    ['complete', () => completeHostAccountLogin(local, 's-1', 'code')],
    ['cancel', () => cancelHostAccountLogin(local, 's-1')]
  ])('refuses %s when this desktop owns the accounts', async (_name, call) => {
    // Why refuse instead of falling back: the interactive add already works
    // here, and running both lanes would create the account twice.
    callRuntimeRpc.mockClear()

    await expect(call()).rejects.toThrow(/owns the accounts/)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })
})
