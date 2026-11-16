import type { Repo } from '../../../../shared/repo-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { isInactiveWorkspace } from '@/lib/worktree-activity-state'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  getWorktreeExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { isWorkspaceFromOtherDevice } from './workspace-creator-visibility'
import { isDefaultBranchWorkspace } from './default-branch-workspace'

/**
 * Whether the "Hide sleeping" sweep must keep this row (#8873).
 *
 * Why isMainWorktree and not isDefaultBranchWorkspace: the project's primary
 * checkout is the repo's only guaranteed entry point. Folder workspaces and
 * detached-HEAD mains fail the default-branch predicate yet often have no
 * sibling row at all, so sweeping them drops the entire project out of the
 * sidebar, Cmd+J and the board with no way back except changing a filter.
 *
 * Why shared: the sidebar pipeline and the jump palette both apply this, and a
 * second copy is how the two surfaces drift.
 */
export function isSleepingSweepExemptWorkspace(
  worktree: Worktree,
  alwaysShowDefaultBranchWorkspace: boolean | undefined
): boolean {
  return alwaysShowDefaultBranchWorkspace !== false && worktree.isMainWorktree
}

export function isAutomationGeneratedWorkspace(worktree: Worktree): boolean {
  return worktree.automationProvenance?.kind === 'created-by-automation'
}

export function isCliCreatedWorkspace(worktree: Worktree): boolean {
  return worktree.cliProvenance?.kind === 'created-by-cli'
}

/**
 * Whether a worktree sits on a detached HEAD (a commit, not a branch).
 *
 * Why the head check: folder workspaces and SSH-synthesized rows carry both an
 * empty branch and an empty head, so branch-emptiness alone would sweep them
 * into this filter. Requiring a real head keeps the predicate to genuine
 * detached-HEAD checkouts, matching what DetachedHeadBadge renders on the card.
 */
export function isDetachedHeadWorkspace(worktree: Worktree): boolean {
  return getWorktreeGitIdentityDisplay(worktree)?.kind === 'detached'
}

// Why this order: it is the order the pipeline has always applied them, so a row several
// filters hide is attributed to the first one and the hidden line's counts sum to its total.
export const SIDEBAR_HIDING_FILTERS = [
  'other-device',
  'default-branch',
  'automation',
  'cli',
  'detached-head',
  'host',
  'project',
  'sleeping'
] as const

export type SidebarHidingFilter = (typeof SIDEBAR_HIDING_FILTERS)[number]

export type SidebarHidingFilterInputs = {
  filterRepoIds: readonly string[]
  showSleepingWorkspaces: boolean
  tabsByWorktree: Record<string, Pick<TerminalTab, 'id'>[]> | null
  ptyIdsByTabId: Record<string, string[]> | null
  browserTabsByWorktree?: Record<string, { id: string }[]> | null
  // Why required: every filter caller must preserve running agents through
  // temporary PTY gaps instead of silently reverting #7197.
  worktreeIdsWithLiveAgent: ReadonlySet<string>
  // Why required: every caller (WorktreeList, getVisibleWorktreeIds
  // fallback, tests) reads the flag from the UI store. Making the field
  // required prevents a future caller from silently dropping the filter by
  // forgetting to pass it.
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
  hideWorkspacesFromOtherDevices: boolean
  pairedDeviceIdsByEnvironment: ReadonlyMap<string, string>
  // Why optional here, against the "why required" rule above: omitting it
  // must fail *open*. A caller that forgets the flag then shows an extra row
  // instead of silently re-hiding the project's entry point, which is the
  // exact regression #8873 reports.
  alwaysShowDefaultBranchWorkspace?: boolean
  repoMap: Map<string, Repo>
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
}

/**
 * Builds the one decision both the visible list and the hidden line read: the first
 * filter that hides a worktree, or null when it stays visible. Archived rows are the
 * caller's concern; no filter decides on them.
 */
export function createSidebarHidingFilterResolver(
  inputs: SidebarHidingFilterInputs
): (worktree: Worktree) => SidebarHidingFilter | null {
  const visibleHostIds =
    inputs.visibleWorkspaceHostIds ??
    (inputs.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [inputs.workspaceHostScope])
  const visibleHostIdSet = visibleHostIds ? new Set(visibleHostIds) : null
  const selectedRepoIds = inputs.filterRepoIds.length > 0 ? new Set(inputs.filterRepoIds) : null

  return (worktree) => {
    if (
      inputs.hideWorkspacesFromOtherDevices &&
      isWorkspaceFromOtherDevice(worktree, inputs.pairedDeviceIdsByEnvironment)
    ) {
      return 'other-device'
    }
    if (inputs.hideDefaultBranchWorkspace && isDefaultBranchWorkspace(worktree)) {
      return 'default-branch'
    }
    if (inputs.hideAutomationGeneratedWorkspaces && isAutomationGeneratedWorkspace(worktree)) {
      return 'automation'
    }
    if (inputs.hideCliCreatedWorkspaces && isCliCreatedWorkspace(worktree)) {
      return 'cli'
    }
    if (inputs.hideDetachedHeadWorkspaces && isDetachedHeadWorkspace(worktree)) {
      return 'detached-head'
    }
    if (visibleHostIdSet) {
      const repo = inputs.repoMap.get(worktree.repoId)
      if (
        !repo ||
        !visibleHostIdSet.has(getWorktreeExecutionHostId(worktree, repo, inputs.defaultHostId))
      ) {
        return 'host'
      }
    }
    if (selectedRepoIds && !selectedRepoIds.has(worktree.repoId)) {
      return 'project'
    }
    // Why no !hideDefaultBranchWorkspace term: that filter already ran above, so an
    // explicit hide still wins over the exemption.
    if (
      !inputs.showSleepingWorkspaces &&
      !isSleepingSweepExemptWorkspace(worktree, inputs.alwaysShowDefaultBranchWorkspace) &&
      isInactiveWorkspace(
        worktree.id,
        inputs.tabsByWorktree,
        inputs.ptyIdsByTabId,
        inputs.browserTabsByWorktree,
        inputs.worktreeIdsWithLiveAgent
      )
    ) {
      return 'sleeping'
    }
    return null
  }
}
