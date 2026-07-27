import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'

export type ClaudeWorktreePinSource = {
  claudeAccountId?: string | null
}

export type ClaudeWorktreePinReassignmentPlan = {
  worktreeIds: string[]
  /** Exactly what `Store.commitClaudeAccountState` expects for its pin argument. */
  pins: Record<string, string | null>
  /** Repos whose renderer worktree lists must be invalidated after the commit. */
  repoIds: string[]
}

/**
 * Move every pin from one Claude account to a chosen destination (null = the
 * system default login). Callers snapshot the worktree metadata at the durable
 * commit point so a worktree created mid-operation cannot escape the move.
 */
export function planClaudeWorktreePinReassignment(
  worktreeMeta: Readonly<Record<string, ClaudeWorktreePinSource>>,
  fromAccountId: string,
  toAccountId: string | null
): ClaudeWorktreePinReassignmentPlan {
  const worktreeIds = Object.entries(worktreeMeta)
    .filter(([, meta]) => meta.claudeAccountId === fromAccountId)
    .map(([worktreeId]) => worktreeId)
    .sort()
  return {
    worktreeIds,
    pins: Object.fromEntries(worktreeIds.map((worktreeId) => [worktreeId, toAccountId])),
    repoIds: [...new Set(worktreeIds.map(getRepoIdFromWorktreeId))]
  }
}
