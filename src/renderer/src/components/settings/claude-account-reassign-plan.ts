import type {
  ClaudeAccountWorktreeUsage,
  ClaudeAccountWorktreeUsageReport
} from '../../../../shared/claude-account-worktree-usage'

/** Why the account change was refused, as far as the renderer can tell from the
 *  main-process message. `in-use` is resolvable here; `launching` needs a retry. */
export type ClaudeAccountBlockReason = 'in-use' | 'launching' | null

const IN_USE_PATTERNS = [
  'in use by an assigned worktree',
  'in use by a global terminal',
  'could not be closed'
]
const LAUNCHING_PATTERNS = [
  'is being launched globally',
  'launch is still starting',
  'terminal is starting',
  'is being changed'
]

export function classifyClaudeAccountBlock(message: string): ClaudeAccountBlockReason {
  const normalized = message.toLowerCase()
  if (IN_USE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'in-use'
  }
  if (LAUNCHING_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'launching'
  }
  return null
}

export type ClaudeAccountReassignPlan = {
  /** Worktrees with a Claude CLI running right now — confirming closes these. */
  liveWorktrees: ClaudeAccountWorktreeUsage[]
  /** Worktrees that only carry the pin; nothing of theirs gets closed. */
  pinnedOnlyWorktrees: ClaudeAccountWorktreeUsage[]
  /** True when confirming terminates at least one Claude CLI. */
  closesTerminals: boolean
  /** Other accounts whose live terminals block this change; their terminals must
   *  close too or the runtime-auth sync refuses no matter what we reassign. */
  blockingAccountIds: string[]
  /** A launch holds the gate with no PTY to close — only waiting clears it. */
  waitingOnLaunch: boolean
}

export function planClaudeAccountReassignment(
  report: ClaudeAccountWorktreeUsageReport
): ClaudeAccountReassignPlan {
  const blockingAccountIds = [
    ...new Set(report.blockedByOtherAccounts.map((terminal) => terminal.accountId))
  ]
  return {
    liveWorktrees: report.worktrees.filter((worktree) => worktree.hasLiveTerminal),
    pinnedOnlyWorktrees: report.worktrees.filter((worktree) => !worktree.hasLiveTerminal),
    closesTerminals: report.liveTerminalCount > 0 || report.blockedByOtherAccounts.length > 0,
    blockingAccountIds,
    waitingOnLaunch: report.pendingLaunchCount > 0 || report.pendingGlobalLaunchCount > 0
  }
}
