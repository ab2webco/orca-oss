import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'

export type ClaudeReauthReopenOutcome = {
  reopenedWorktreeIds: string[]
  failedWorktreeIds: string[]
}

/**
 * Relaunch Claude in every worktree whose terminal the re-auth had to close.
 *
 * The pin was never moved, so each new tab launches under the same account the
 * closed session held. A worktree that fails to relaunch is reported, never
 * thrown: the re-authentication itself already succeeded by this point.
 */
export function reopenClaudeTerminalsAfterReauth(
  worktreeIds: readonly string[]
): ClaudeReauthReopenOutcome {
  const outcome: ClaudeReauthReopenOutcome = {
    reopenedWorktreeIds: [],
    failedWorktreeIds: []
  }
  for (const worktreeId of new Set(worktreeIds)) {
    try {
      const launched = launchAgentInNewTab({
        agent: 'claude',
        worktreeId,
        launchSource: 'unknown'
      })
      if (launched?.tabId) {
        outcome.reopenedWorktreeIds.push(worktreeId)
      } else {
        outcome.failedWorktreeIds.push(worktreeId)
      }
    } catch {
      outcome.failedWorktreeIds.push(worktreeId)
    }
  }
  return outcome
}
