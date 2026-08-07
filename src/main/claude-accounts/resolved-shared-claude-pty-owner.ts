import { getClaudeLivePtyPersistence } from './claude-live-pty-persistence'
import { notifyClaudePtyReleased } from './live-pty-drain-listeners'
import {
  releaseLiveClaudePtyRefreshChain,
  reserveLiveClaudePtyRefreshChain
} from './live-claude-refresh-chain-claims'
import {
  liveClaudePtyIds,
  liveSharedClaudePtyAccounts,
  unknownOwnerSharedClaudePtyIds
} from './live-pty-account-state'

/**
 * Records the owner a live shared PTY's own process revealed, clearing the
 * unknown-ownership block for that id. Ignores ids that are not currently
 * unknown so this can never reassign a PTY whose owner a launch already bound.
 */
export function recordResolvedSharedClaudePtyOwner(
  ptyId: string,
  accountId: string | null
): boolean {
  if (!unknownOwnerSharedClaudePtyIds.has(ptyId) || !liveClaudePtyIds.has(ptyId)) {
    return false
  }
  liveSharedClaudePtyAccounts.set(ptyId, accountId)
  unknownOwnerSharedClaudePtyIds.delete(ptyId)
  try {
    getClaudeLivePtyPersistence()?.addClaudeLivePtySessionId(ptyId, accountId, {
      accountResolved: true
    })
  } catch (error) {
    liveSharedClaudePtyAccounts.set(ptyId, null)
    unknownOwnerSharedClaudePtyIds.add(ptyId)
    throw error
  }
  // Why re-reserve: the seeded claim registered no fingerprint (accountId was
  // null), which blocks background rotation for every account forever. A claim
  // that names the account protects only that chain.
  releaseLiveClaudePtyRefreshChain(ptyId)
  reserveLiveClaudePtyRefreshChain(ptyId, accountId)
  // Why: launches refused by the wildcard are waiting on exactly this signal.
  notifyClaudePtyReleased()
  return true
}
