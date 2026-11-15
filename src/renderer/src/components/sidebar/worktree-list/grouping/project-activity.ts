import type { Worktree } from '../../../../../../shared/worktree/types'
import type { ProjectTierMemory } from './project-tier-order'
import type { WorkspaceUrgencySignal } from './project-urgency-tier'

/** Owner decision (ORCA-1216): a project is active with activity in the last 24 h, by default. */
export const PROJECT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000

export type ProjectActivityInputs = {
  now: number
  /** The workspace the sidebar marks as current; its project is always active. */
  currentWorktreeId: string | null
  liveAgentWorktreeIds: ReadonlySet<string>
  /** The sidebarActivityWindowHours setting, in ms. */
  windowMs: number
  /** Opts into the Needs you first tiers (ORCA-1216 §4); absent leaves headers on their age. */
  urgency?: ProjectUrgencyInputs
}

export type ProjectUrgencyInputs = {
  signalByWorktreeId: ReadonlyMap<string, WorkspaceUrgencySignal>
  /** Workspaces whose open PR fails CI, from the live prCache (no new GitHub reads). */
  ciFailingWorktreeIds: ReadonlySet<string>
  tierMemory: ProjectTierMemory
}

type ActivityWorktree = Pick<Worktree, 'id' | 'lastActivityAt'>

export function isWorkspaceActive(
  worktree: ActivityWorktree,
  inputs: ProjectActivityInputs
): boolean {
  return (
    worktree.id === inputs.currentWorktreeId ||
    inputs.liveAgentWorktreeIds.has(worktree.id) ||
    // Why: Rest is the only tier the window decides; a signal or red CI never folds (§4, §6).
    inputs.urgency?.signalByWorktreeId.has(worktree.id) === true ||
    inputs.urgency?.ciFailingWorktreeIds.has(worktree.id) === true ||
    inputs.now - worktree.lastActivityAt < inputs.windowMs
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

/** Newest activity among the workspaces; null when none has a timestamp, so no age is invented. */
export function getLatestActivityAt(
  worktrees: readonly Pick<Worktree, 'lastActivityAt'>[]
): number | null {
  let latest = 0
  for (const worktree of worktrees) {
    latest = Math.max(latest, worktree.lastActivityAt)
  }
  return latest > 0 ? latest : null
}
