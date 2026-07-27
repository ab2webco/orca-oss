/** One worktree pinned to a Claude account. `hasLiveTerminal` is deliberately a
 *  separate fact from the pin: a pin with no live session blocks nothing. */
export type ClaudeAccountWorktreeUsage = {
  worktreeId: string
  displayName: string
  hasLiveTerminal: boolean
}

/** A live Claude terminal owned by a *different* account that still blocks the
 *  pending mutation, because the runtime-auth sync guards the active account. */
export type ClaudeAccountBlockingTerminal = {
  ptyId: string
  accountId: string
  worktreeId: string | null
  displayName: string | null
}

/** Everything the reassign dialog needs to name what is in the way. */
export type ClaudeAccountWorktreeUsageReport = {
  accountId: string
  /** Every worktree carrying the pin, live or not. */
  worktrees: ClaudeAccountWorktreeUsage[]
  /** PTYs the force-close path can actually terminate for this account. */
  liveTerminalCount: number
  /** Launches reserved for this account that own no PTY yet, so force-close has
   *  nothing to kill — the dialog says "wait" instead of offering a dead action. */
  pendingLaunchCount: number
  /** Global Claude launches whose account is not bound yet. They block a shared-auth
   *  change (select/reauthenticate) but not an account-record change. */
  pendingGlobalLaunchCount: number
  /** Live terminals of other accounts that block this mutation anyway. */
  blockedByOtherAccounts: ClaudeAccountBlockingTerminal[]
  /** False on remote runtimes, where Orca owns no host PTYs or pins to move. */
  supported: boolean
}

export type ClaudeWorktreeAccountReassignment = {
  fromAccountId: string
  /** null means the system default Claude login. */
  toAccountId: string | null
  closeLiveTerminals: boolean
  /** Accounts other than `fromAccountId` whose live terminals also block. */
  closeLiveTerminalAccountIds?: readonly string[]
}

export function emptyClaudeAccountWorktreeUsageReport(
  accountId: string,
  supported = false
): ClaudeAccountWorktreeUsageReport {
  return {
    accountId,
    worktrees: [],
    liveTerminalCount: 0,
    pendingLaunchCount: 0,
    pendingGlobalLaunchCount: 0,
    blockedByOtherAccounts: [],
    supported
  }
}
