import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { usePluginPanelsStore, type PluginPanelsFetchStatus } from '@/store/plugin-panels'
import { useEnabledPluginNavPanels } from './plugin-surface-pages'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'

export type PluginNavRouteInput = {
  pluginSystemEnabled: boolean
  fetchStatus: PluginPanelsFetchStatus
  /** Every view the router can land on: the active one plus each back target. */
  routedViews: readonly TopLevelView[]
  activeNavTabKey: string | null
  liveNavTabKeys: readonly string[]
}

/** True once the nav route points at a panel the authoritative list no longer
 *  offers — uninstalled, disabled, or the plugin system switched off. */
export function shouldClearPluginNavRoute(input: PluginNavRouteInput): boolean {
  const { pluginSystemEnabled, fetchStatus, routedViews, activeNavTabKey, liveNavTabKeys } = input
  if (!routedViews.includes('plugin') && activeNavTabKey === null) {
    return false
  }
  // Why: only a settled list proves removal; a disabled feature needs no proof.
  if (pluginSystemEnabled && fetchStatus !== 'ready') {
    return false
  }
  if (!pluginSystemEnabled) {
    return true
  }
  return activeNavTabKey === null || !liveNavTabKeys.includes(activeNavTabKey)
}

function useRoutedViews(): TopLevelView[] {
  const activeView = useAppStore((s) => s.activeView)
  const beforeTasks = useAppStore((s) => s.previousViewBeforeTasks)
  const beforeSettings = useAppStore((s) => s.previousViewBeforeSettings)
  const beforeActivity = useAppStore((s) => s.previousViewBeforeActivity)
  const beforeAutomations = useAppStore((s) => s.previousViewBeforeAutomations)
  const beforeSpace = useAppStore((s) => s.previousViewBeforeSpace)
  const beforeMobile = useAppStore((s) => s.previousViewBeforeMobile)
  const beforeArtifacts = useAppStore((s) => s.previousViewBeforeArtifacts)
  return [
    activeView,
    beforeTasks,
    beforeSettings,
    beforeActivity,
    beforeAutomations,
    beforeSpace,
    beforeMobile,
    beforeArtifacts
  ]
}

/** Keeps the left-sidebar plugin destination from outliving its plugin. */
export function usePluginNavRouteReconciliation(): void {
  const pluginSystemEnabled = useAppStore((s) => s.settings?.pluginSystemEnabled === true)
  const fetchStatus = usePluginPanelsStore((s) => s.fetchStatus)
  const navPanels = useEnabledPluginNavPanels()
  const activeNavTabKey = useAppStore((s) => s.activePluginNavTabKey)
  const clearPluginNavRoute = useAppStore((s) => s.clearPluginNavRoute)
  const routedViews = useRoutedViews()
  const stale = shouldClearPluginNavRoute({
    pluginSystemEnabled,
    fetchStatus,
    routedViews,
    activeNavTabKey,
    liveNavTabKeys: navPanels.map((panel) => panel.tabKey)
  })
  useEffect(() => {
    if (stale) {
      clearPluginNavRoute()
    }
  }, [clearPluginNavRoute, stale])
}
