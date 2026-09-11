import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import type { PtyTransport } from './pty-transport'

/**
 * The runtime that owns a pane's live PTY, or `null` when it runs locally.
 *
 * Why this and not the app's active runtime: the accounts, vaults and sessions
 * a pane can reach belong to the host actually running its agent, and the app's
 * active runtime is a different question — frequently `null` while the pane's
 * owner is a server. Reading the active one is what made the switch menu offer
 * this desktop's accounts for a server-hosted terminal: same emails, different
 * ids, and the switch died on "no managed Claude account matches that selector".
 */
export function resolvePaneOwnerEnvironmentId(
  paneTransports: Map<number, PtyTransport>,
  paneId: number | null
): string | null {
  if (paneId === null) {
    return null
  }
  const ptyId = paneTransports.get(paneId)?.getPtyId()
  return ptyId ? getRemoteRuntimePtyEnvironmentId(ptyId) : null
}
