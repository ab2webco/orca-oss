import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

/** One address the pairing wizard can advertise. Mirrors the main-process shape. */
export type PairingNetworkInterface = {
  name: string
  address: string
  hasDefaultRoute?: boolean
}

const PAIRING_INTERFACES_TIMEOUT_MS = 10_000

/** List the addresses of the machine that will be paired.
 *
 *  Why routed instead of always local: the wizard advertises the host the phone
 *  will connect to, and with a server active that host is not the one drawing
 *  the UI. Asking the local process there yields this computer's addresses,
 *  which the phone cannot use to reach the server — or, in the web client,
 *  yields nothing at all and the wizard dead-ends on "No interfaces found".
 */
export async function listPairingNetworkInterfaces(
  activeRuntimeEnvironmentId: string | null | undefined
): Promise<PairingNetworkInterface[]> {
  // Why the caller passes it instead of this module reading the store: the
  // owning host is a decision of the screen, and a hidden store read makes the
  // dependency invisible to whoever renders it.
  const target = getActiveRuntimeTarget({ activeRuntimeEnvironmentId: activeRuntimeEnvironmentId ?? null })
  if (target.kind === 'environment') {
    const response = await callRuntimeRpc<{ interfaces: PairingNetworkInterface[] }>(
      target,
      'pairing.listNetworkInterfaces',
      undefined,
      { timeoutMs: PAIRING_INTERFACES_TIMEOUT_MS }
    )
    return response.interfaces
  }
  const result = await window.api.mobile.listNetworkInterfaces()
  return result.interfaces
}
