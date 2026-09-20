import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PAIRING_MOBILE_QR_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { createMobilePairingQr, supportsMobilePairingQr } from './runtime-pairing-qr'

const callRuntimeRpc = vi.hoisted(() => vi.fn())
const runtimeEnvironmentSupportsCapability = vi.hoisted(() => vi.fn())

vi.mock('./runtime-rpc-client', () => ({
  callRuntimeRpc,
  runtimeEnvironmentSupportsCapability,
  getActiveRuntimeTarget: (settings: { activeRuntimeEnvironmentId?: string | null } | null) =>
    settings?.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: settings.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

const webClient = { value: false }
vi.mock('@/lib/web-client-location', () => ({
  isWebClientLocation: () => webClient.value
}))

const localShimQr = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  webClient.value = false
  localShimQr.mockResolvedValue({ available: false })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { api: { mobile: { getPairingQR: localShimQr } } }
  })
})

describe('mobile pairing QR routing', () => {
  // Why this is the whole point of the RPC: the QR carries the address the phone must
  // reach. Minting it on the client would advertise the client's own machine.
  it('mints the QR on the active server instead of this machine', async () => {
    callRuntimeRpc.mockResolvedValueOnce({ available: true, endpoint: 'ws://10.0.0.9:6768' })

    await expect(createMobilePairingQr('env-1', { address: '10.0.0.9' })).resolves.toMatchObject({
      endpoint: 'ws://10.0.0.9:6768'
    })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'pairing.createMobileQr',
      { address: '10.0.0.9' },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
    expect(localShimQr).not.toHaveBeenCalled()
  })

  it('mints through the local surface when no server owns the pairing', async () => {
    await createMobilePairingQr(null, { rotate: true })

    expect(localShimQr).toHaveBeenCalledWith({ rotate: true })
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })
})

describe('mobile pairing QR support probe', () => {
  it('asks the owning server whether it can mint at all', async () => {
    runtimeEnvironmentSupportsCapability.mockResolvedValueOnce(false)

    await expect(supportsMobilePairingQr('env-1')).resolves.toBe(false)
    expect(runtimeEnvironmentSupportsCapability).toHaveBeenCalledWith(
      'env-1',
      PAIRING_MOBILE_QR_RUNTIME_CAPABILITY
    )
  })

  // Why the web client probes a "local" target: its local target IS the server serving
  // the page, and that server may predate the method.
  it('reads the serving runtime capabilities in the web client', async () => {
    webClient.value = true
    callRuntimeRpc.mockResolvedValueOnce({ capabilities: ['runtime.environments.v1'] })

    await expect(supportsMobilePairingQr(null)).resolves.toBe(false)

    callRuntimeRpc.mockResolvedValueOnce({
      capabilities: [PAIRING_MOBILE_QR_RUNTIME_CAPABILITY]
    })
    await expect(supportsMobilePairingQr(null)).resolves.toBe(true)
  })

  it('never probes on the desktop, where the same build answers', async () => {
    await expect(supportsMobilePairingQr(null)).resolves.toBe(true)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })
})
