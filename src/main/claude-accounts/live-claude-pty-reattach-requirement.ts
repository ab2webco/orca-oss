/**
 * Whether restoring a surviving Claude PTY must reattach to whichever daemon
 * still owns it, instead of minting a fresh session under the same id.
 *
 * Why injected (account-directed) sessions count too (ORCA-124): only shared
 * sessions asked for it, so after a daemon protocol crossing an account-directed
 * pane fell through DaemonPtyRouter.adapterFor's `?? this.current` fallback and
 * created an empty session on the NEW daemon while the real CLI kept running in
 * the legacy one — a blank pane plus an orphan, with no error anywhere.
 *
 * Why this cannot break cold restore: both liveness facts are seeded from
 * persistence and then reconciled against every adapter (legacy included) by
 * confirmSeededClaudeLivePtys before any pane restores, so a set flag already
 * proves some daemon hosts the session.
 */
export function requiresLiveClaudePtyReattach(input: {
  isExistingSharedClaudeSession: boolean
  existingInjectedAccountId: string | null
}): boolean {
  return input.isExistingSharedClaudeSession || input.existingInjectedAccountId !== null
}
