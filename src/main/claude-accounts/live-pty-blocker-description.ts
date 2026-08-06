import { parsePtySessionId } from '../../shared/pty-session-id-format'
import { getWorktreePathBasenameFromId } from '../../shared/worktree-id'
import {
  liveInjectedClaudePtyAccounts,
  liveSharedClaudePtyAccounts,
  unknownOwnerSharedClaudePtyIds
} from './live-pty-account-state'

/** Resolves a worktree id to its user-facing display name, when one is known. */
export type LiveClaudeWorktreeDisplayNameLookup = (worktreeId: string) => string | null

/** The terminal handle and title a blocking PTY is reachable by, so the user can
 *  find it among many open terminals instead of guessing (ORCA-190). */
export type LiveClaudeTerminalDescription = { handle?: string | null; title?: string | null }
export type LiveClaudeTerminalDescriptionLookup = (
  ptyId: string
) => LiveClaudeTerminalDescription | null

let worktreeDisplayNames: LiveClaudeWorktreeDisplayNameLookup | null = null
let terminalDescriptions: LiveClaudeTerminalDescriptionLookup | null = null

/** Lets live-PTY gate errors name the blocking worktree by its user-facing
 *  display name; without it they fall back to the worktree path basename. */
export function attachLiveClaudeWorktreeDisplayNames(
  lookup: LiveClaudeWorktreeDisplayNameLookup | null
): void {
  worktreeDisplayNames = lookup
}

/** Lets live-PTY gate errors name the blocking terminal itself, not just the
 *  worktree hosting it. Without it the messages keep the worktree-only wording. */
export function attachLiveClaudeTerminalDescriptions(
  lookup: LiveClaudeTerminalDescriptionLookup | null
): void {
  terminalDescriptions = lookup
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

/**
 * Names each blocking PTY individually — terminal handle and title where known,
 * plus the worktree hosting it. Unlike the worktree-only description these are
 * NOT deduplicated: two blocking terminals in one worktree are two things the
 * user has to find.
 */
export function describeLiveClaudePtyTerminals(
  ptyIds: Iterable<string>,
  lookups: {
    displayName: LiveClaudeWorktreeDisplayNameLookup | null
    terminal: LiveClaudeTerminalDescriptionLookup | null
  }
): string[] {
  const described: string[] = []
  for (const ptyId of ptyIds) {
    const [worktreeName] = describeLiveClaudePtyWorktrees([ptyId], lookups.displayName)
    const terminal = lookups.terminal?.(ptyId) ?? null
    const handle = terminal?.handle?.trim() || null
    const title = terminal?.title?.trim() || null
    const location = worktreeName?.startsWith('PTY ')
      ? worktreeName
      : `in "${worktreeName ?? 'an unknown worktree'}"`
    const identity = handle
      ? title
        ? `terminal ${handle} "${title}"`
        : `terminal ${handle}`
      : title
        ? `"${title}"`
        : null
    described.push(identity ? `${identity} ${location}` : location)
  }
  return described
}

function blockingLiveClaudePtyIds(
  livePtyAccounts: ReadonlyMap<string, string | null>,
  accountId: string | null,
  treatUnknownOwnerAsBlocking: boolean
): string[] {
  return [...livePtyAccounts.entries()]
    .filter(([ptyId, ownerAccountId]) => {
      if (accountId === null) {
        return true
      }
      return (
        ownerAccountId === accountId ||
        (treatUnknownOwnerAsBlocking && unknownOwnerSharedClaudePtyIds.has(ptyId))
      )
    })
    .map(([ptyId]) => ptyId)
}

function describeBlockingLiveClaudePtys(
  livePtyAccounts: ReadonlyMap<string, string | null>,
  accountId: string | null,
  treatUnknownOwnerAsBlocking = false
): string[] {
  return describeLiveClaudePtyWorktrees(
    blockingLiveClaudePtyIds(livePtyAccounts, accountId, treatUnknownOwnerAsBlocking),
    worktreeDisplayNames
  )
}

function quoteNames(worktreeNames: readonly string[]): string {
  return worktreeNames.map((name) => `"${name}"`).join(', ')
}

function joinTerminalDescriptions(descriptions: readonly string[]): string {
  return descriptions.join('; ')
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

export function buildGlobalTerminalLaunchBlockMessage(
  blockers: readonly string[],
  // Why named separately: an unknown-ownership blocker is not "this account is
  // busy" — Orca could not read which account that terminal uses, so it blocks
  // every account. Saying so is the difference between an actionable message and
  // the unfindable terminal ORCA-190 reports.
  unknownOwnerBlockers: readonly string[] = []
): string {
  const head = 'This Claude account is already in use by a global terminal'
  if (blockers.length === 0 && unknownOwnerBlockers.length === 0) {
    return `${head}. Close it before launching the assigned account.`
  }
  const sentences: string[] = []
  if (blockers.length > 0) {
    sentences.push(`${head} (${joinTerminalDescriptions(blockers)}).`)
  } else {
    sentences.push(`${head}.`)
  }
  if (unknownOwnerBlockers.length > 0) {
    const subject =
      unknownOwnerBlockers.length === 1
        ? 'A global Claude terminal whose account Orca could not read'
        : 'Global Claude terminals whose account Orca could not read'
    sentences.push(
      `${subject} blocks every assigned account until it exits (${joinTerminalDescriptions(unknownOwnerBlockers)}).`
    )
  }
  const close =
    blockers.length + unknownOwnerBlockers.length === 1
      ? 'Close it before launching the assigned account.'
      : 'Close them before launching the assigned account.'
  return `${sentences.join(' ')} ${close}`
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
  const lookups = { displayName: worktreeDisplayNames, terminal: terminalDescriptions }
  const blockingIds = blockingLiveClaudePtyIds(liveSharedClaudePtyAccounts, accountId, true)
  const unknownOwnerIds = blockingIds.filter((ptyId) => unknownOwnerSharedClaudePtyIds.has(ptyId))
  const knownOwnerIds = blockingIds.filter((ptyId) => !unknownOwnerSharedClaudePtyIds.has(ptyId))
  return new Error(
    buildGlobalTerminalLaunchBlockMessage(
      describeLiveClaudePtyTerminals(knownOwnerIds, lookups),
      describeLiveClaudePtyTerminals(unknownOwnerIds, lookups)
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
          ? describeBlockingLiveClaudePtys(liveSharedClaudePtyAccounts, accountId, true)
          : [])
      ])
    ])
  )
}
