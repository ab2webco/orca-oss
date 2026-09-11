import React from 'react'
import { useTabStripOverflowNavigation } from './tab-strip-overflow-navigation'
import { useTabStripDragScrollHandlers } from './tab-strip-drag-scroll'
import type { TabBarProps } from './tab-bar-props'
import type { TabBarItem } from './tab-bar-item-model'
import { useTabBarRuntimeModel } from './use-tab-bar-runtime-model'
import { useTabBarCreateMenuController } from './use-tab-bar-create-menu-controller'
import { useTabBarItemProjection } from './use-tab-bar-item-projection'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useRemoteRuntimeActionPending } from '@/runtime/use-remote-runtime-action-pending'
import { renderTabBarSurface } from './tab-bar-surface'

function TabBarInner(props: TabBarProps): React.JSX.Element {
  const {
    worktreeId,
    groupId,
    terminalOnly = false,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onNewSimulatorTab,
    onNewFileTab,
    onOpenFileTab,
    onPinFile
  } = props
  const runtime = useTabBarRuntimeModel({ worktreeId, groupId })
  const createMenu = useTabBarCreateMenuController({
    worktreeId,
    resolvedGroupId: runtime.resolvedGroupId,
    terminalOnly,
    mobileEmulatorEnabled: runtime.mobileEmulatorEnabled,
    managedBrowserCreationEnabled: runtime.managedBrowserCreationEnabled,
    mobileEmulatorCreationEnabled: runtime.mobileEmulatorCreationEnabled,
    workspaceHasSimulatorTab: runtime.workspaceHasSimulatorTab,
    showWindowsShellMenu: runtime.showWindowsShellMenu,
    projectRuntimeShellMenuMode: runtime.projectRuntimeShellMenuMode,
    defaultWindowsShell: runtime.defaultWindowsShell,
    defaultWindowsPowerShellImplementation: runtime.defaultWindowsPowerShellImplementation,
    windowsTerminalCapabilities: runtime.windowsTerminalCapabilities,
    agentLaunchOptions: runtime.agentLaunchOptions,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onNewSimulatorTab,
    onNewFileTab,
    onOpenFileTab
  })
  const itemProjection = useTabBarItemProjection({
    props,
    resolvedGroupId: runtime.resolvedGroupId,
    unifiedTabs: runtime.unifiedTabs,
    unifiedTabByVisibleId: runtime.unifiedTabByVisibleId,
    generatedTabTitlesEnabled: runtime.generatedTabTitlesEnabled,
    statusByRelativePath: runtime.statusByRelativePath
  })
  const togglePinned = (item: TabBarItem): void => {
    // pinTab/unpinTab mirror the change to the host for remote-server tabs.
    if (item.isPinned) {
      runtime.unpinTab(item.unifiedTabId)
      return
    }
    if (item.type === 'editor' && onPinFile) {
      onPinFile(item.data.id, item.unifiedTabId)
      return
    }
    runtime.pinTab(item.unifiedTabId)
  }
  const tabStripNavigation = useTabStripOverflowNavigation({
    activeVisibleTabId: itemProjection.activeVisibleTabId,
    layoutKey: itemProjection.tabStripLayoutKey,
    tabCount: itemProjection.orderedItems.length,
    worktreeId
  })
  const tabStripDragScroll = useTabStripDragScrollHandlers(tabStripNavigation.scrollTabStrip, {
    start: tabStripNavigation.tabStripOverflowState.canScrollStart,
    end: tabStripNavigation.tabStripOverflowState.canScrollEnd
  })
  // Why solo remoto: en local la tab aparece al instante y el spinner solo
  // parpadearia. Contra un host remoto el clic se queda sin respuesta visible
  // durante todo el round-trip, y el usuario vuelve a pulsar (ORCA-481).
  const remoteEnvironmentId = useAppStore((state) =>
    worktreeId ? getRuntimeEnvironmentIdForWorktree(state, worktreeId) : null
  )
  const terminalPending = useRemoteRuntimeActionPending(remoteEnvironmentId, worktreeId, 'terminal')
  const browserPending = useRemoteRuntimeActionPending(remoteEnvironmentId, worktreeId, 'browser')
  const remoteCreationPending = terminalPending || browserPending

  return renderTabBarSurface({
    props,
    runtime,
    createMenu,
    itemProjection,
    tabStripNavigation,
    tabStripDragScroll,
    togglePinned,
    remoteCreationPending
  })
}

export default React.memo(TabBarInner)
