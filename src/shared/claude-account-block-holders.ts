/** Only the fields naming a holder. Stated structurally so a client that decodes
 *  the wire report defensively can pass what it kept, not the full record. */
export type ClaudeAccountHolderFacts = {
  worktrees: readonly { worktreeId: string; displayName: string; hasLiveTerminal: boolean }[]
  pendingLaunchCount: number
  pendingGlobalLaunchCount: number
  blockedByOtherAccounts: readonly { accountId: string }[]
  supported: boolean
}

/**
 * What is holding a Claude account, for a client that can only report and not
 * resolve. `unknown` is deliberately distinct from `none`: an unreported holder
 * and no holder look identical in the report's arrays, and rendering the first
 * as the second tells the user nothing is in the way while the switch keeps
 * failing.
 */
export type ClaudeAccountHolders =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'held'; worktreeNames: string[]; otherAccountCount: number; waitingOnLaunch: boolean }

export function describeClaudeAccountHolders(
  report: ClaudeAccountHolderFacts | null | undefined
): ClaudeAccountHolders {
  if (!report || !report.supported) {
    return { kind: 'unknown' }
  }
  const worktreeNames = report.worktrees
    .filter((worktree) => worktree.hasLiveTerminal)
    .map((worktree) => worktree.displayName || worktree.worktreeId)
  const waitingOnLaunch = report.pendingLaunchCount > 0 || report.pendingGlobalLaunchCount > 0
  const otherAccountCount = new Set(
    report.blockedByOtherAccounts.map((terminal) => terminal.accountId)
  ).size
  if (worktreeNames.length === 0 && otherAccountCount === 0 && !waitingOnLaunch) {
    return { kind: 'none' }
  }
  return { kind: 'held', worktreeNames, otherAccountCount, waitingOnLaunch }
}

/** The line to append to a refused switch, or null when it would add nothing. */
export function claudeAccountHoldersMessage(holders: ClaudeAccountHolders): string | null {
  if (holders.kind === 'none') {
    return null
  }
  if (holders.kind === 'unknown') {
    return 'The host did not report which worktree holds it.'
  }
  const parts: string[] = []
  if (holders.worktreeNames.length > 0) {
    parts.push(`Running Claude in ${holders.worktreeNames.join(', ')}.`)
  }
  if (holders.otherAccountCount > 0) {
    parts.push(
      holders.otherAccountCount === 1
        ? 'Another account has a live terminal that blocks the change too.'
        : `${holders.otherAccountCount} other accounts have live terminals that block the change too.`
    )
  }
  if (holders.waitingOnLaunch) {
    parts.push('A launch is still starting, so waiting is the only thing that clears it.')
  }
  parts.push('Close it on the desktop, then try again.')
  return parts.join(' ')
}
