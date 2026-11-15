import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import type { AppState } from '@/store/types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import { getSettingsFocusedExecutionHostId } from '../../../../../../shared/execution-host'
import { computeVisibleWorktreeIds, sidebarHasActiveFilters } from '../../visible-worktrees'
import { createSidebarHidingFilterResolver } from '../../sidebar-hiding-filters'
import {
  breakDownWorktreesHiddenByFilters,
  EMPTY_HIDDEN_BY_FILTERS,
  type HiddenByFiltersBreakdown
} from '../../sidebar-filter-hidden-count'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment
} from '../../workspace-creator-visibility'
import {
  getVisibleWorktreeBrowserActivityTabs,
  getVisibleWorktreeTerminalActivityTabs
} from '../../visible-worktree-activity-inputs'
import type { SortBy } from '../../smart-sort'
import type { SidebarWorktreeFilters } from './use-filters'
import { useReusedArrayIdentity } from './use-reused-array-identity'

const EMPTY_WORKTREE_ID_SET: ReadonlySet<string> = new Set()

// Applies every sidebar filter to the sorted id stream. Flatten/filter/sort goes through the
// shared utility so card order matches Cmd+1–9 numbering. With revealHiddenByFilters, the rows
// the filters hide come back in their sorted place and are listed in revealedHiddenIds.
export function useVisibleSidebarWorktrees(args: {
  filterState: SidebarWorktreeFilters['filterState']
  sortBy: SortBy
  sortedIds: string[]
  repoMap: Map<string, Repo>
  worktreeMap: Map<string, Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
  settings: AppState['settings']
  agentSendTargetWorktreeId: string | null
  revealHiddenByFilters: boolean
}) {
  const { filterState, sortBy, sortedIds, repoMap, worktreeMap, worktreeLineageById, settings } =
    args
  const {
    showSleepingWorkspaces,
    filterRepoIds,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces,
    hideWorkspacesFromOtherDevices,
    alwaysShowDefaultBranchWorkspace,
    visibleWorkspaceHostIds,
    workspaceHostScope
  } = filterState
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const agentStatusEpoch = useAppStore((s) => (!showSleepingWorkspaces ? s.agentStatusEpoch : 0))
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const pairedDeviceIdsByEnvironment = useMemo(
    () =>
      hideWorkspacesFromOtherDevices
        ? getPairedDeviceIdsByEnvironment(runtimeEnvironments, runtimeStatusByEnvironmentId)
        : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    [hideWorkspacesFromOtherDevices, runtimeEnvironments, runtimeStatusByEnvironmentId]
  )

  // Read tabsByWorktree when needed for filtering or sorting
  const needsActivityMaps = !showSleepingWorkspaces || sortBy === 'smart'
  const tabsByWorktree = useAppStore((s) =>
    needsActivityMaps ? getVisibleWorktreeTerminalActivityTabs(s.tabsByWorktree) : null
  )
  const ptyIdsByTabId = useAppStore((s) => (needsActivityMaps ? s.ptyIdsByTabId : null))
  const browserTabsByWorktree = useAppStore((s) =>
    !showSleepingWorkspaces ? getVisibleWorktreeBrowserActivityTabs(s.browserTabsByWorktree) : null
  )

  const hasFilters = sidebarHasActiveFilters(filterState)
  const recomputed = useMemo(() => {
    void agentStatusEpoch
    const opts = {
      filterRepoIds,
      showSleepingWorkspaces,
      tabsByWorktree,
      ptyIdsByTabId,
      browserTabsByWorktree,
      // Why snapshot on agentStatusEpoch: update membership immediately without repainting on every hook ping.
      worktreeIdsWithLiveAgent: showSleepingWorkspaces
        ? EMPTY_WORKTREE_ID_SET
        : getWorktreeIdsWithLiveAgent(
            useAppStore.getState().agentStatusByPaneKey,
            tabsByWorktree,
            Date.now()
          ),
      hideDefaultBranchWorkspace,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDetachedHeadWorkspaces,
      hideWorkspacesFromOtherDevices,
      pairedDeviceIdsByEnvironment,
      alwaysShowDefaultBranchWorkspace,
      repoMap,
      workspaceHostScope,
      visibleWorkspaceHostIds,
      defaultHostId: getSettingsFocusedExecutionHostId(settings),
      worktreeLineageById
    }
    const forced = args.agentSendTargetWorktreeId ? [args.agentSendTargetWorktreeId] : []
    const ids = computeVisibleWorktreeIds(worktreesByRepo, sortedIds, {
      ...opts,
      forcedVisibleWorktreeIds: forced
    })
    // Why the hasFilters gate: the line has always counted only what a non-default filter hides.
    const hidden: HiddenByFiltersBreakdown = hasFilters
      ? breakDownWorktreesHiddenByFilters(
          sortedIds,
          ids,
          worktreeMap,
          createSidebarHidingFilterResolver(opts)
        )
      : EMPTY_HIDDEN_BY_FILTERS
    const reveal = args.revealHiddenByFilters && hidden.total > 0
    // Why forced-visible: the pipeline then sorts them into their usual slot, lineage included.
    const shownIds = reveal
      ? computeVisibleWorktreeIds(worktreesByRepo, sortedIds, {
          ...opts,
          forcedVisibleWorktreeIds: [...forced, ...hidden.hiddenIds]
        })
      : ids
    return {
      worktrees: shownIds.map((id) => worktreeMap.get(id)).filter((w): w is Worktree => w != null),
      hidden,
      revealedKey: reveal ? hidden.hiddenIds.join('\0') : ''
    }
  }, [
    args.agentSendTargetWorktreeId,
    args.revealHiddenByFilters,
    hasFilters,
    agentStatusEpoch,
    filterRepoIds,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces,
    hideWorkspacesFromOtherDevices,
    alwaysShowDefaultBranchWorkspace,
    workspaceHostScope,
    visibleWorkspaceHostIds,
    settings,
    repoMap,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    sortedIds,
    worktreeMap,
    worktreeLineageById,
    worktreesByRepo,
    pairedDeviceIdsByEnvironment
  ])
  // Why: agentStatusEpoch bumps recompute this memo even when membership and
  // order are unchanged; keeping the previous identity stops the whole
  // rows/sectionRows/renderedWorktrees chain from churning per epoch.
  const visibleWorktrees = useReusedArrayIdentity(recomputed.worktrees)
  // Why keyed on content: an epoch recompute must not hand every row a new set.
  const { revealedKey } = recomputed
  const revealedHiddenWorktreeIds = useMemo<ReadonlySet<string>>(
    () => (revealedKey ? new Set(revealedKey.split('\0')) : EMPTY_WORKTREE_ID_SET),
    [revealedKey]
  )

  return {
    visibleWorktrees,
    hiddenByFilters: recomputed.hidden,
    revealedHiddenWorktreeIds,
    pairedDeviceIdsByEnvironment
  }
}
