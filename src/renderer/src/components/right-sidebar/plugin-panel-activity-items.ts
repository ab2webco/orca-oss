import { isWorktreeSurfacePanel, type ActivePluginPanel } from '@/store/plugin-panels'
import { resolvePluginPanelIcon } from './plugin-panel-icon'
import type { ActivityBarItem } from './activity-bar-buttons'

/** Maps active plugin panel contributions onto right-sidebar activity items.
 *  Filtering happens here and not in `collectActivePluginPanels` because the
 *  Settings surface resolves its panel through that same collection. */
export function getPluginPanelActivityItems(
  panels: ActivePluginPanel[],
  panelErrors: Readonly<Record<string, true>> = {}
): ActivityBarItem[] {
  return panels.filter(isWorktreeSurfacePanel).map((panel) => ({
    id: panel.tabKey,
    icon: resolvePluginPanelIcon(panel),
    // Why: panel titles come from plugin manifests, not the app catalog, so
    // they render untranslated by design.
    title: panel.title,
    shortcut: '',
    ...(panelErrors[panel.tabKey] ? { statusIndicator: 'failure' as const } : {})
  }))
}
