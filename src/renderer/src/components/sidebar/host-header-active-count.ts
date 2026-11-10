import type { WorktreeStatus } from '@/lib/worktree-status'
import { useWorktreeActivityStatuses } from './use-worktree-activity-statuses'

/** V30's host row counts agents at work, including one waiting on the user. */
export function countActiveWorktrees(statuses: ReadonlyMap<string, WorktreeStatus>): number {
  let active = 0
  for (const status of statuses.values()) {
    if (status === 'working' || status === 'permission') {
      active += 1
    }
  }
  return active
}

export function useHostActiveAgentCount(worktreeIds: readonly string[]): number {
  return countActiveWorktrees(useWorktreeActivityStatuses(worktreeIds))
}
