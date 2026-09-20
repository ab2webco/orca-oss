import { isWebClientLocation } from '@/lib/web-client-location'
import { PAIRING_MOBILE_QR_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { MobilePairingConnectionMode } from '../../../shared/mobile-pairing-connection-mode'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  runtimeEnvironmentSupportsCapability
} from './runtime-rpc-client'

export type MobilePairingQrArgs = {
  address?: string
  connectionMode?: MobilePairingConnectionMode
  rotate?: boolean
}

export type MobilePairingQrResponse = Awaited<ReturnType<typeof window.api.mobile.getPairingQR>>

const PAIRING_QR_TIMEOUT_MS = 20_000

/** Mint a mobile pairing QR on the machine the phone will connect to.
 *
 *  Why routed instead of always local: the QR advertises the host's address, and with a
 *  server active that host is not the one drawing the UI. Minting locally would hand the
 *  phone a code for the wrong machine — it fails at scan time with nothing to diagnose.
 */
export async function createMobilePairingQr(
  activeRuntimeEnvironmentId: string | null | undefined,
  args: MobilePairingQrArgs = {}
): Promise<MobilePairingQrResponse> {
  const target = getActiveRuntimeTarget({
    activeRuntimeEnvironmentId: activeRuntimeEnvironmentId ?? null
  })
  if (target.kind === 'environment') {
    return await callRuntimeRpc<MobilePairingQrResponse>(target, 'pairing.createMobileQr', args, {
      timeoutMs: PAIRING_QR_TIMEOUT_MS
    })
  }
  // The web client's own shim routes this to the runtime serving the page, which is the
  // machine being paired; on the desktop it is this process.
  return await window.api.mobile.getPairingQR(args)
}

/** Whether the machine that would be paired can mint the QR at all.
 *
 *  Asked up front rather than on click: an older host answers method_not_found, and a
 *  Generate button that fails afterwards reads as a transient glitch worth retrying.
 */
export async function supportsMobilePairingQr(
  activeRuntimeEnvironmentId: string | null | undefined
): Promise<boolean> {
  const target = getActiveRuntimeTarget({
    activeRuntimeEnvironmentId: activeRuntimeEnvironmentId ?? null
  })
  if (target.kind === 'environment') {
    return await runtimeEnvironmentSupportsCapability(
      target.environmentId,
      PAIRING_MOBILE_QR_RUNTIME_CAPABILITY
    )
  }
  if (!isWebClientLocation()) {
    // The desktop mints it in this same build, so there is no version skew to probe.
    return true
  }
  const status = await callRuntimeRpc<{ capabilities?: string[] }>({ kind: 'local' }, 'status.get')
  return status.capabilities?.includes(PAIRING_MOBILE_QR_RUNTIME_CAPABILITY) === true
}
