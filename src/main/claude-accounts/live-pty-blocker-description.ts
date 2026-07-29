import { parsePtySessionId } from '../../shared/pty-session-id-format'
import { getWorktreePathBasenameFromId } from '../../shared/worktree-id'
import {
  liveInjectedClaudePtyAccounts,
  liveSharedClaudePtyAccounts
} from './live-pty-account-state'

/** Resolves a worktree id to its user-facing display name, when one is known. */
export type LiveClaudeWorktreeDisplayNameLookup = (worktreeId: string) => string | null

let worktreeDisplayNames: LiveClaudeWorktreeDisplayNameLookup | null = null

/** Lets live-PTY gate errors name the blocking worktree by its user-facing
 *  display name; without it they fall back to the worktree path basename. */
export function attachLiveClaudeWorktreeDisplayNames(
  lookup: LiveClaudeWorktreeDisplayNameLookup | null
): void {
  worktreeDisplayNames = lookup
}

/**
 * Names the worktrees hosting live Claude PTYs. Ids not minted with a
 * worktree fall back to their PTY id so the user can still identify them.
 */
export function describeLiveClaudePtyWorktrees(
  ptyIds: Iterable<string>,
  displayName: LiveClaudeWorktreeDisplayNameLookup | null
): string[] {
  const names = new Set<string>()
  for (const ptyId of ptyIds) {
    const { worktreeId } = parsePtySessionId(ptyId)
    if (!worktreeId) {
      names.add(`PTY ${ptyId}`)
      continue
    }
    const name =
      displayName?.(worktreeId)?.trim() || getWorktreePathBasenameFromId(worktreeId) || null
    if (name) {
      names.add(name)
    }
  }
  return [...names]
}

function describeBlockingLiveClaudePtys(
  livePtyAccounts: ReadonlyMap<string, string | null>,
  accountId: string | null
): string[] {
  return describeLiveClaudePtyWorktrees(
    [...livePtyAccounts.entries()]
      .filter(([, ownerAccountId]) =>
        accountId === null ? true : ownerAccountId === null || ownerAccountId === accountId
      )
      .map(([ptyId]) => ptyId),
    worktreeDisplayNames
  )
}

function quoteNames(worktreeNames: readonly string[]): string {
  return worktreeNames.map((name) => `"${name}"`).join(', ')
}

// Why the fixed sentence heads: the renderer classifies account blocks by the
// substrings 'in use by an assigned worktree' and 'in use by a global
// terminal' (claude-account-reassign-plan.ts); enrichment may only append.
export function buildAssignedWorktreeLaunchBlockMessage(worktreeNames: readonly string[]): string {
  if (worktreeNames.length === 0) {
    return 'This Claude account is in use by an assigned worktree. Close that Claude terminal before launching it globally.'
  }
  const close =
    worktreeNames.length === 1 ? 'Close that Claude terminal' : 'Close those Claude terminals'
  return `This Claude account is in use by an assigned worktree (${quoteNames(worktreeNames)}). ${close} before launching it globally, or launch this terminal with an assigned Claude account.`
}

export function buildGlobalTerminalLaunchBlockMessage(worktreeNames: readonly string[]): string {
  if (worktreeNames.length === 0) {
    return 'This Claude account is already in use by a global terminal. Close it before launching the assigned account.'
  }
  return `This Claude account is already in use by a global terminal (in ${quoteNames(worktreeNames)}). Close it before launching the assigned account.`
}

export function buildAccountMutationBlockMessage(worktreeNames: readonly string[]): string {
  if (worktreeNames.length === 0) {
    return 'This Claude account is in use by an assigned worktree. Close its Claude terminal before changing the account.'
  }
  return `This Claude account is in use by an assigned worktree (${quoteNames(worktreeNames)}). Close its Claude terminal before changing the account.`
}

export function createAssignedWorktreeLaunchBlockError(accountId: string | null): Error {
  return new Error(
    buildAssignedWorktreeLaunchBlockMessage(
      describeBlockingLiveClaudePtys(liveInjectedClaudePtyAccounts, accountId)
    )
  )
}

export function createGlobalTerminalLaunchBlockError(accountId: string): Error {
  return new Error(
    buildGlobalTerminalLaunchBlockMessage(
      describeBlockingLiveClaudePtys(liveSharedClaudePtyAccounts, accountId)
    )
  )
}

export function createAccountMutationBlockError(
  accountId: string,
  // Why: mutations opting into allowLiveSharedPtys are not blocked by shared
  // terminals, so those must not be named as blockers.
  includeSharedBlockers: boolean
): Error {
  return new Error(
    buildAccountMutationBlockMessage([
      ...new Set([
        ...describeBlockingLiveClaudePtys(liveInjectedClaudePtyAccounts, accountId),
        ...(includeSharedBlockers
          ? describeBlockingLiveClaudePtys(liveSharedClaudePtyAccounts, accountId)
          : [])
      ])
    ])
  )
}
