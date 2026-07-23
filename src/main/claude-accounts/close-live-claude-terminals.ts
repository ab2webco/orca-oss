import {
  hasLiveInjectedClaudePtysForAccount,
  hasLiveSharedClaudePtysForAccount,
  liveInjectedClaudePtyAccounts,
  liveSharedClaudePtyAccounts,
  markClaudePtyExited
} from './live-pty-gate'

/** Stops one PTY and resolves true only once its OS process is confirmed gone. */
export type ClaudePtyTerminator = (ptyId: string) => Promise<boolean>

/**
 * Live PTY ids the idle gate treats as owning this account: injected PTYs bound
 * to it, plus shared PTYs bound to it OR to a still-unknown owner (null). Launch
 * reservations have no PTY to kill, so they are intentionally excluded.
 */
export function getLiveClaudePtyIdsForAccount(accountId: string): string[] {
  const injected: ReadonlyMap<string, string> = liveInjectedClaudePtyAccounts
  const shared: ReadonlyMap<string, string | null> = liveSharedClaudePtyAccounts
  const ptyIds = new Set<string>()
  for (const [ptyId, liveAccountId] of injected) {
    if (liveAccountId === accountId) {
      ptyIds.add(ptyId)
    }
  }
  for (const [ptyId, liveAccountId] of shared) {
    if (liveAccountId === null || liveAccountId === accountId) {
      ptyIds.add(ptyId)
    }
  }
  return [...ptyIds]
}

/**
 * Terminate every live Claude PTY (injected or shared) the idle gate attributes
 * to the account, then confirm the gate is clear so removal's idle assertion can
 * pass. Killing the process — not just clearing the registry — is what stops the
 * account's single-use OAuth refresh chain, so we only clear the gate for a PTY
 * whose termination the terminator confirmed.
 */
export async function closeLiveClaudeTerminalsForAccount(
  accountId: string,
  terminate: ClaudePtyTerminator
): Promise<void> {
  for (const ptyId of getLiveClaudePtyIdsForAccount(accountId)) {
    const stopped = await terminate(ptyId)
    if (!stopped) {
      throw new Error(
        'A Claude terminal using this account could not be closed. Try again in a moment.'
      )
    }
    // Why: termination is confirmed, so clear the gate now — a lagging async exit
    // event must not leave stale ownership that blocks the removal that follows.
    markClaudePtyExited(ptyId)
  }
  if (
    hasLiveInjectedClaudePtysForAccount(accountId) ||
    hasLiveSharedClaudePtysForAccount(accountId)
  ) {
    // Why: a terminal or launch reservation for this account raced in after we
    // enumerated; refuse rather than delete credentials a live CLI still holds.
    throw new Error(
      'This Claude account is in use by an assigned worktree. Close its Claude terminal before changing the account.'
    )
  }
}
