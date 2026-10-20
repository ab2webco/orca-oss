import { describe, expect, it, vi } from 'vitest'
import {
  confirmRemoteUpdateInstall,
  type DeviceAuthenticator
} from './remote-update-install-confirm'

function authenticator(result: Awaited<ReturnType<DeviceAuthenticator['authenticateAsync']>>) {
  return {
    authenticateAsync: vi.fn(
      async (_options?: Parameters<DeviceAuthenticator['authenticateAsync']>[0]) => result
    )
  }
}

describe('confirmRemoteUpdateInstall', () => {
  it('asks for biometrics with the device passcode as fallback', async () => {
    const auth = authenticator({ success: true })

    await expect(confirmRemoteUpdateInstall(auth)).resolves.toEqual({ ok: true })
    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false })
    )
    expect(auth.authenticateAsync.mock.calls[0]?.[0]?.promptMessage).toMatch(/desktop update/i)
  })

  it.each(['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback'] as const)(
    'treats %s as a cancel',
    async (error) => {
      await expect(
        confirmRemoteUpdateInstall(authenticator({ success: false, error }))
      ).resolves.toEqual({ ok: false, reason: 'cancelled' })
    }
  )

  it.each(['passcode_not_set', 'not_enrolled', 'not_available'] as const)(
    'refuses when the phone has no lock (%s)',
    async (error) => {
      await expect(
        confirmRemoteUpdateInstall(authenticator({ success: false, error }))
      ).resolves.toEqual({ ok: false, reason: 'no-device-lock' })
    }
  )

  it('refuses on a failed or locked-out check', async () => {
    await expect(
      confirmRemoteUpdateInstall(authenticator({ success: false, error: 'lockout' }))
    ).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('fails closed when the native module throws', async () => {
    const auth = {
      authenticateAsync: vi.fn(async () => {
        throw new Error('module missing')
      })
    }
    await expect(confirmRemoteUpdateInstall(auth)).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
  })
})
