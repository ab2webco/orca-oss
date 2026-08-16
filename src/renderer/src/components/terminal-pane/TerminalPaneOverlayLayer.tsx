import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup, TerminalTab } from '../../../../shared/types'
import { useAppStore } from '../../store'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from '../activity/activity-terminal-portal'
import { shouldMountBackgroundWorktreeTab } from '../terminal/background-terminal-worktree-mount'
import { useNativeChatToggleShortcut } from '../native-chat/use-native-chat-toggle-shortcut'
import { TerminalOverlaySlot } from './TerminalOverlaySlot'
import { useTerminalTabColdParking } from './use-terminal-tab-cold-parking'

type TerminalOverlayAssignment = {
  unifiedTabId: string
  groupId: string
  isActiveInGroup: boolean
}

const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = []
const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []
const EMPTY_ACTIVITY_PORTALS: ActivityTerminalPortalTarget[] = []

const TerminalPaneOverlayLayer = memo(function TerminalPaneOverlayLayer({
  worktreeId,
  worktreePath,
  isWorktreeActive,
  isPreparingIncoming = false,
  coldParkTerminalPanes = false,
  isForceParked = false,
  shouldMeasureHiddenWorktree = false,
  activityTerminalPortals = EMPTY_ACTIVITY_PORTALS,
  backgroundMountTabIds = null,
  activationDeferredMountTabIds = null,
  onTerminalMountReadyChange
}: {
  worktreeId: string
  worktreePath: string
  isWorktreeActive: boolean
  /** The incoming worktree of a switch: mounted, still hidden, awaited by the reveal gate. */
  isPreparingIncoming?: boolean
  coldParkTerminalPanes?: boolean
  /** Retention-budget force-park keeps eviction-exempt tabs mounted. */
  isForceParked?: boolean
  shouldMeasureHiddenWorktree?: boolean
  activityTerminalPortals?: ActivityTerminalPortalTarget[]
  /** Targeted mounts connect only these terminal tabs. */
  backgroundMountTabIds?: ReadonlySet<string> | null
  /** Cold-activation deferred tabs receive immediate parked watcher coverage. */
  activationDeferredMountTabIds?: ReadonlySet<string> | null
  onTerminalMountReadyChange?: (worktreeId: string, tabId: string, ready: boolean) => void
}): React.JSX.Element | null {
  const { terminalTabs, unifiedTabs, groups, activeGroupId } = useAppStore(
    useShallow((state) => ({
      terminalTabs: state.tabsByWorktree[worktreeId] ?? EMPTY_TERMINAL_TABS,
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
      activeGroupId: state.activeGroupIdByWorktree[worktreeId]
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)
  const consumeSuppressedPtyExit = useAppStore((state) => state.consumeSuppressedPtyExit)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const reconcileWorktreeTabModel = useAppStore((state) => state.reconcileWorktreeTabModel)

  useNativeChatToggleShortcut(worktreeId, isWorktreeActive)

  const leaveWorktreeIfEmpty = useCallback(() => {
    const state = useAppStore.getState()
    if (state.activeWorktreeId !== worktreeId) {
      return
    }
    const { renderableTabCount } = reconcileWorktreeTabModel(worktreeId)
    if (renderableTabCount === 0) {
      setActiveWorktree(null)
    }
  }, [reconcileWorktreeTabModel, setActiveWorktree, worktreeId])

  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )

  const groupActiveTabById = useMemo(() => {
    const lookup: Record<string, string | null | undefined> = {}
    for (const group of groups) {
      lookup[group.id] = group.activeTabId
    }
    return lookup
  }, [groups])

  const assignments = useMemo(() => {
    const entries = new Map<string, TerminalOverlayAssignment>()
    for (const tab of unifiedTabs) {
      if (tab.contentType !== 'terminal') {
        continue
      }
      entries.set(tab.entityId, {
        unifiedTabId: tab.id,
        groupId: tab.groupId,
        isActiveInGroup: groupActiveTabById[tab.groupId] === tab.id
      })
    }
    return entries
  }, [groupActiveTabById, unifiedTabs])

  const parkedTerminalTabIds = useTerminalTabColdParking({
    worktreeId,
    terminalTabs,
    assignments,
    // Why (ORCA-229): the reveal gate withholds isWorktreeActive until the incoming panes
    // report their mount, and per-tab cold parking keys its unpark on that same flag — a
    // parked group-active tab could never mount, so the switch would resolve on the
    // stranding backstop. Parking sees the incoming worktree as active; the render below
    // keeps using the raw flag so nothing paints or takes focus before the reveal.
    isWorktreeActive: isWorktreeActive || isPreparingIncoming,
    coldParkTerminalPanes,
    isForceParked,
    shouldMeasureHiddenWorktree,
    activityTerminalPortals,
    activationDeferredMountTabIds
  })

  if (!worktreePath) {
    return null
  }

  return (
    <>
      {terminalTabs
        .filter((terminalTab) =>
          shouldMountBackgroundWorktreeTab(backgroundMountTabIds, terminalTab.id)
        )
        .map((terminalTab) => {
          const assignment = assignments.get(terminalTab.id)
          const isVisible = Boolean(isWorktreeActive && assignment?.isActiveInGroup)
          const isActive = Boolean(isVisible && assignment?.groupId === activeGroupId)
          const activityTerminalPortal = findActivityTerminalPortal(activityTerminalPortals, {
            worktreeId,
            tabId: terminalTab.id
          })
          if (parkedTerminalTabIds.has(terminalTab.id)) {
            return null
          }
          return (
            <TerminalOverlaySlot
              key={terminalTab.id}
              terminalTabId={terminalTab.id}
              terminalGeneration={terminalTab.generation}
              worktreeId={worktreeId}
              worktreePath={worktreePath}
              startupCwd={terminalTab.startupCwd}
              groupId={assignment?.groupId}
              isWorktreeActive={isWorktreeActive}
              isVisible={isVisible}
              isActive={isActive}
              activityTerminalPortal={activityTerminalPortal}
              onMountReadyChange={onTerminalMountReadyChange}
              onFocusOwningGroup={focusOwningGroup}
              consumeSuppressedPtyExit={consumeSuppressedPtyExit}
              leaveWorktreeIfEmpty={leaveWorktreeIfEmpty}
            />
          )
        })}
    </>
  )
})

export default TerminalPaneOverlayLayer
