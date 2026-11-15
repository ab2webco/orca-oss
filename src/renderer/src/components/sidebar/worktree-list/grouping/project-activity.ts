import type { Worktree } from '../../../../../../shared/worktree/types'

/** Owner decision (ORCA-1216): a project is active with activity in the last 24 h. */
export const PROJECT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000

export type ProjectActivityInputs = {
  now: number
  /** The workspace the sidebar marks as current; its project is always active. */
  currentWorktreeId: string | null
  liveAgentWorktreeIds: ReadonlySet<string>
}

type ActivityWorktree = Pick<Worktree, 'id' | 'lastActivityAt'>

export function isWorkspaceActive(
  worktree: ActivityWorktree,
  inputs: ProjectActivityInputs
): boolean {
  return (
    worktree.id === inputs.currentWorktreeId ||
    inputs.liveAgentWorktreeIds.has(worktree.id) ||
    inputs.now - worktree.lastActivityAt < PROJECT_ACTIVITY_WINDOW_MS
  )
}

export function isProjectActive(
  worktrees: readonly ActivityWorktree[],
  inputs: ProjectActivityInputs
): boolean {
  return worktrees.some((worktree) => isWorkspaceActive(worktree, inputs))
}

/** The workspace a one-row project opens: the most recent one, main on a tie. */
export function pickProjectOpenWorktree<
  T extends Pick<Worktree, 'lastActivityAt' | 'isMainWorktree'>
>(worktrees: readonly T[]): T | null {
  let best: T | null = null
  for (const worktree of worktrees) {
    if (
      best === null ||
      worktree.lastActivityAt > best.lastActivityAt ||
      (worktree.lastActivityAt === best.lastActivityAt &&
        worktree.isMainWorktree &&
        !best.isMainWorktree)
    ) {
      best = worktree
    }
  }
  return best
}
