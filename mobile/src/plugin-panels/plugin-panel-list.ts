import { isPluginPanelMountedStatus } from '../../../src/shared/plugins/plugin-panel-mount-status'

// Mirrors MOBILE_PLUGIN_PANELS_RUNTIME_CAPABILITY in src/shared/protocol-version.ts.
// Older hosts refuse every plugins.* call from a phone, so the entry stays hidden.
export const MOBILE_PLUGIN_PANELS_CAPABILITY = 'mobile.plugin-panels.v1'

export function arePluginPanelsSupportedByHost(
  capabilities: readonly string[] | undefined
): boolean {
  return capabilities?.includes(MOBILE_PLUGIN_PANELS_CAPABILITY) === true
}

export type HostablePluginPanelSurface = 'nav' | 'settings'

export type HostablePluginPanel = {
  pluginKey: string
  pluginName: string
  panelId: string
  title: string
  surface: HostablePluginPanelSurface
}

const SURFACE_ORDER: Record<HostablePluginPanelSurface, number> = { nav: 0, settings: 1 }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Panels a phone can host from a `plugins.list` result. Worktree panels stay
 *  out: they read the context of a desktop worktree the phone does not have.
 *  The host re-checks approval on open; this only decides what is offered. */
export function listHostablePluginPanels(result: unknown): HostablePluginPanel[] {
  if (!Array.isArray(result)) {
    return []
  }
  const panels: HostablePluginPanel[] = []
  for (const entry of result as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const plugin = entry as {
      pluginKey?: unknown
      name?: unknown
      status?: unknown
      panels?: unknown
    }
    const pluginKey = readString(plugin.pluginKey)
    const status = readString(plugin.status)
    if (
      !pluginKey ||
      !status ||
      !isPluginPanelMountedStatus(status) ||
      !Array.isArray(plugin.panels)
    ) {
      continue
    }
    const pluginName = readString(plugin.name) ?? pluginKey
    for (const raw of plugin.panels as unknown[]) {
      if (typeof raw !== 'object' || raw === null) {
        continue
      }
      const panel = raw as { id?: unknown; title?: unknown; surface?: unknown }
      const panelId = readString(panel.id)
      const surface = panel.surface === 'nav' || panel.surface === 'settings' ? panel.surface : null
      if (!panelId || !surface) {
        continue
      }
      panels.push({
        pluginKey,
        pluginName,
        panelId,
        title: readString(panel.title) ?? panelId,
        surface
      })
    }
  }
  return panels.sort(
    (a, b) =>
      SURFACE_ORDER[a.surface] - SURFACE_ORDER[b.surface] ||
      a.pluginName.localeCompare(b.pluginName) ||
      a.title.localeCompare(b.title)
  )
}
