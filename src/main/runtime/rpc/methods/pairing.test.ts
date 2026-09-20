import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { PAIRING_METHODS } from './pairing'

type DispatchOptions = NonNullable<Parameters<RpcDispatcher['dispatchStreaming']>[2]>

function dispatchPairing(
  method: string,
  params: unknown,
  pairing: DispatchOptions['pairing'],
  mobilePairingQr?: DispatchOptions['mobilePairingQr']
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const dispatcher = new RpcDispatcher({
      runtime: new OrcaRuntimeService(),
      methods: PAIRING_METHODS
    })
    void dispatcher.dispatchStreaming(
      { id: 'request-1', authToken: '', method, params },
      (response) => resolve(JSON.parse(response) as Record<string, unknown>),
      { pairing, ...(mobilePairingQr ? { mobilePairingQr } : {}) }
    )
  })
}

describe('pairing RPC methods', () => {
  it('passes only phone-owned credential material to the server-bound provider', async () => {
    const provisionRelay = vi.fn().mockResolvedValue({
      v: 1,
      reqId: 'install-1',
      authorizationMode: 'authenticated-direct',
      currentVersion: 1,
      resumeExpiresAt: Date.now() + 60_000
    })
    const pairing = { getEndpoints: vi.fn(), provisionRelay }

    await expect(
      dispatchPairing(
        'pairing.provisionRelay',
        { reqId: 'install-1', newResumeTokenHash: 'A'.repeat(43) },
        pairing
      )
    ).resolves.toMatchObject({ ok: true })
    expect(provisionRelay).toHaveBeenCalledWith({
      reqId: 'install-1',
      newResumeTokenHash: 'A'.repeat(43)
    })
  })

  it('rejects caller-selected identity and authorization metadata', async () => {
    const pairing = { getEndpoints: vi.fn(), provisionRelay: vi.fn() }

    for (const injected of [
      { relayDeviceId: 'attacker-device' },
      { authorization: { mode: 'relay-basis', basisConnId: 'attacker-basis' } },
      { directAuthId: 'attacker-direct' },
      { acceptedCredentialVersion: 99 }
    ]) {
      await expect(
        dispatchPairing(
          'pairing.provisionRelay',
          { reqId: 'install-1', newResumeTokenHash: 'A'.repeat(43), ...injected },
          pairing
        )
      ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    }
    await expect(
      dispatchPairing(
        'pairing.getEndpoints',
        { installReqId: 'status-1', basisConnId: 'injected' },
        pairing
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(pairing.provisionRelay).not.toHaveBeenCalled()
    expect(pairing.getEndpoints).not.toHaveBeenCalled()
  })

  // Why this one has no `pairing` context and the others do: it reads the host's
  // own addresses, not a pairing session. A remote client must be able to ask
  // for them or the wizard has nothing to advertise for the machine it pairs.
  it('answers pairing.listNetworkInterfaces without a pairing context', async () => {
    const response = await dispatchPairing(
      'pairing.listNetworkInterfaces',
      undefined,
      undefined as never
    )

    expect(response).toMatchObject({ ok: true })
    const result = (response as { result: { interfaces: unknown } }).result
    expect(Array.isArray(result.interfaces)).toBe(true)
  })

  // Why the host mints it: a client-built QR would carry the browser's address, not the
  // address of the machine the phone must reach.
  it('mints the pairing QR on the host and forwards the caller-picked address', async () => {
    const mobilePairingQr = vi.fn().mockResolvedValue({
      available: true,
      qrDataUrl: 'data:image/png;base64,AAA',
      pairingUrl: 'orca://pair?code=abc',
      endpoint: 'ws://100.64.0.2:6768',
      deviceId: 'device-1',
      connectionMode: 'local-only'
    })

    const response = await dispatchPairing(
      'pairing.createMobileQr',
      { address: '100.64.0.2', connectionMode: 'local-only', rotate: true },
      undefined as never,
      mobilePairingQr
    )

    expect(response).toMatchObject({
      ok: true,
      result: { available: true, endpoint: 'ws://100.64.0.2:6768' }
    })
    expect(mobilePairingQr).toHaveBeenCalledWith({
      address: '100.64.0.2',
      connectionMode: 'local-only',
      rotate: true
    })
  })

  it('refuses pairing.createMobileQr when no host can mint it', async () => {
    await expect(
      dispatchPairing('pairing.createMobileQr', {}, undefined as never)
    ).resolves.toMatchObject({ ok: false })
  })
})
