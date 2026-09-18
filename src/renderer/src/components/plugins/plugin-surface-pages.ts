import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  usePluginNavPanels,
  usePluginSettingsPanels,
  type ActivePluginPanel
} from '@/store/plugin-panels'

/** Stable identity so consumers' memos do not rebuild on every render. */
const NO_PANELS: ActivePluginPanel[] = []

function usePluginSystemEnabled(): boolean {
  return useAppStore((state) => state.settings?.pluginSystemEnabled === true)
}

/** Panels owning a page in Settings. One hook so the nav row and the pane that
 *  renders it can never disagree about which panels exist. */
export function useEnabledPluginSettingsPanels(): ActivePluginPanel[] {
  const enabled = usePluginSystemEnabled()
  const panels = usePluginSettingsPanels()
  return useMemo(() => (enabled ? panels : NO_PANELS), [enabled, panels])
}

/** Panels owning a first-level destination in the left sidebar. */
export function useEnabledPluginNavPanels(): ActivePluginPanel[] {
  const enabled = usePluginSystemEnabled()
  const panels = usePluginNavPanels()
  return useMemo(() => (enabled ? panels : NO_PANELS), [enabled, panels])
}
