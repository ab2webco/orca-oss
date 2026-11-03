import type { ConnectConfig } from 'ssh2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadHostKeyTrustSourcesMock,
  rememberHostKeyMock,
  resetHostKeyTrustSourcesMocks
} from './ssh-host-key-trust-sources-mock'
import { createResolvedConfig, createTarget } from './ssh-connection-test-fixtures'
import { hostKeyBlob } from './ssh-host-key-test-keys'
import { HostKeyVerificationError } from './ssh-host-key-verifier'
import { installSsh2HostKeyVerification } from './ssh2-host-key-verification'

vi.mock('./ssh-host-key-trust-sources', async () =>
  (await import('./ssh-host-key-trust-sources-mock')).createHostKeyTrustSourcesModule()
)

function install(strictHostKeyChecking?: string) {
  const config: ConnectConfig = { host: 'example.com', port: 22 }
  const verdict = installSsh2HostKeyVerification(config, {
    target: createTarget(),
    resolved: createResolvedConfig({ strictHostKeyChecking }),
    isCurrentAttempt: () => true,
    onAcceptedFingerprint: vi.fn()
  })
  return { config, verdict }
}

describe('installSsh2HostKeyVerification', () => {
  beforeEach(() => {
    resetHostKeyTrustSourcesMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refuses the host when the trust sources do not load in time', async () => {
    vi.useFakeTimers()
    loadHostKeyTrustSourcesMock.mockReturnValue(new Promise(() => {}))
    const { verdict } = install()
    const settled = expect(verdict).rejects.toBeInstanceOf(HostKeyVerificationError)

    await vi.advanceTimersByTimeAsync(5_000)
    await settled
  })

  it('refuses the host when the trust sources throw', async () => {
    loadHostKeyTrustSourcesMock.mockRejectedValue(new Error('userData path unavailable'))

    await expect(install().verdict).rejects.toThrow(/Host key verification failed for example\.com/)
  })

  it('connects without recording when StrictHostKeyChecking is off and the sources fail', async () => {
    loadHostKeyTrustSourcesMock.mockRejectedValue(new Error('userData path unavailable'))
    const { config, verdict } = install('false')
    await verdict

    const verify = vi.fn()
    ;(config.hostVerifier as (key: Buffer, cb: (ok: boolean) => void) => void)(
      hostKeyBlob('ssh-ed25519', 1),
      verify
    )
    expect(verify).toHaveBeenCalledWith(true)
    expect(rememberHostKeyMock).not.toHaveBeenCalled()
  })
})
