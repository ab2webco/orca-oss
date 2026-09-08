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

  // Why refuse rather than fall back to the desktop flow: on the local host the
  // interactive add already works, and running both would create the account
  // twice — once through IPC and once through the runtime.
  it.each([
    ['begin', () => beginHostAccountLogin(local, 'claude')],
    ['complete', () => completeHostAccountLogin(local, 's-1', 'code')],
    ['cancel', () => cancelHostAccountLogin(local, 's-1')]
  ])('refuses %s when no server owns the accounts', async (_name, call) => {
    callRuntimeRpc.mockClear()

    await expect(call()).rejects.toThrow(/only used when an Orca server owns the accounts/)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })
})
