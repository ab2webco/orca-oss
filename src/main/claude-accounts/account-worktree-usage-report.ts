import { parsePtySessionId } from '../../shared/pty-session-id-format'
import { splitWorktreeId } from '../../shared/worktree-id'
import type {
  ClaudeAccountBlockingTerminal,
  ClaudeAccountWorktreeUsage,
  ClaudeAccountWorktreeUsageReport
} from '../../shared/claude-account-worktree-usage'

export type ClaudeAccountUsageWorktreeMeta = {
  displayName?: string
  claudeAccountId?: string | null
}

export type ClaudeAccountUsageInputs = {
  accountId: string
  worktreeMeta: Readonly<Record<string, ClaudeAccountUsageWorktreeMeta>>
  liveInjectedPtyAccounts: ReadonlyMap<string, string>
  liveSharedPtyAccounts: ReadonlyMap<string, string | null>
  injectedLaunchReservations: ReadonlyMap<string, string>
  sharedLaunchReservations: ReadonlyMap<string, string | null>
  /** Shared PTYs whose owner is still unknown — the only ones a `null` in
   *  liveSharedPtyAccounts attributes to every account (ORCA-190). */
  unknownOwnerSharedPtyIds: ReadonlySet<string>
  /** Account the runtime-auth sync will materialize; its live pinned CLIs guard
   *  the sync even when the user is changing an entirely different account. */
  activeAccountId: string | null
}

function resolveDisplayName(
  worktreeId: string,
  meta: Readonly<Record<string, ClaudeAccountUsageWorktreeMeta>>
): string {
  const displayName = meta[worktreeId]?.displayName
  if (typeof displayName === 'string' && displayName.trim() !== '') {
    return displayName
  }
  return splitWorktreeId(worktreeId)?.worktreePath ?? worktreeId
}

/** PTY ids the force-close path attributes to the account — the same rule
 *  `getLiveClaudePtyIdsForAccount` uses, including shared PTYs of unknown owner. */
function collectAttributedPtyIds(inputs: ClaudeAccountUsageInputs): string[] {
  const ptyIds = new Set<string>()
  for (const [ptyId, liveAccountId] of inputs.liveInjectedPtyAccounts) {
    if (liveAccountId === inputs.accountId) {
      ptyIds.add(ptyId)
    }
  }
  for (const [ptyId, liveAccountId] of inputs.liveSharedPtyAccounts) {
    if (liveAccountId === inputs.accountId || inputs.unknownOwnerSharedPtyIds.has(ptyId)) {
      ptyIds.add(ptyId)
    }
  }
  return [...ptyIds]
}

/** Launches the gate refuses that own no PTY yet: a force-close has nothing to
 *  kill, so the dialog must offer waiting rather than a button that cannot work. */
function countPendingLaunches(inputs: ClaudeAccountUsageInputs): {
  pendingLaunchCount: number
  pendingGlobalLaunchCount: number
} {
  const injected = [...inputs.injectedLaunchReservations.values()].filter(
    (reservedAccountId) => reservedAccountId === inputs.accountId
  ).length
  const sharedForAccount = [...inputs.sharedLaunchReservations.values()].filter(
    (reservedAccountId) => reservedAccountId === inputs.accountId
  ).length
  return {
    pendingLaunchCount: injected + sharedForAccount,
    pendingGlobalLaunchCount: [...inputs.sharedLaunchReservations.values()].filter(
      (reservedAccountId) => reservedAccountId === null
    ).length
  }
}

function collectBlockingTerminals(
  inputs: ClaudeAccountUsageInputs
): ClaudeAccountBlockingTerminal[] {
  const { activeAccountId } = inputs
  if (activeAccountId === null || activeAccountId === inputs.accountId) {
    return []
  }
  const blocking: ClaudeAccountBlockingTerminal[] = []
  for (const [ptyId, liveAccountId] of inputs.liveInjectedPtyAccounts) {
    if (liveAccountId !== activeAccountId) {
      continue
    }
    const worktreeId = parsePtySessionId(ptyId).worktreeId
    blocking.push({
      ptyId,
      accountId: liveAccountId,
      worktreeId,
      displayName: worktreeId === null ? null : resolveDisplayName(worktreeId, inputs.worktreeMeta)
    })
  }
  return blocking
}

/**
 * Describe every worktree that uses a Claude account, splitting the durable pin
 * from a Claude CLI that is live right now, and naming what still blocks the
 * change once those terminals are closed.
 */
export function buildClaudeAccountWorktreeUsageReport(
  inputs: ClaudeAccountUsageInputs
): ClaudeAccountWorktreeUsageReport {
  const attributedPtyIds = collectAttributedPtyIds(inputs)
  const liveWorktreeIds = new Set(
    attributedPtyIds
      .map((ptyId) => parsePtySessionId(ptyId).worktreeId)
      .filter((worktreeId): worktreeId is string => worktreeId !== null)
  )
  const pinnedWorktreeIds = Object.entries(inputs.worktreeMeta)
    .filter(([, meta]) => meta.claudeAccountId === inputs.accountId)
    .map(([worktreeId]) => worktreeId)
  // Why: a terminal can outlive the pin that launched it, so the union is what
  // "uses this account" really means — reporting pins alone would hide it.
  const worktreeIds = [...new Set([...pinnedWorktreeIds, ...liveWorktreeIds])].sort()
  const worktrees: ClaudeAccountWorktreeUsage[] = worktreeIds.map((worktreeId) => ({
    worktreeId,
    displayName: resolveDisplayName(worktreeId, inputs.worktreeMeta),
    hasLiveTerminal: liveWorktreeIds.has(worktreeId)
  }))
  return {
    accountId: inputs.accountId,
    worktrees,
    liveTerminalCount: attributedPtyIds.length,
    ...countPendingLaunches(inputs),
    blockedByOtherAccounts: collectBlockingTerminals(inputs),
    supported: true
  }
}
