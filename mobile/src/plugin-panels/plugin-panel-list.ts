import { isPluginPanelMountedStatus } from '../../../src/shared/plugins/plugin-panel-mount-status'
import {
  isPluginPanelIconSvgAttribute,
  isPluginPanelIconSvgTag,
  type PluginPanelIconSvgNode
} from '../../../src/shared/plugins/plugin-panel-icon-svg'

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
  /** Curated lucide name or a relative .svg path; resolved by PluginPanelIcon. */
  icon?: string
  /** Host-sanitized custom icon, re-checked here; wins over `icon`. */
  iconSvg?: PluginPanelIconSvgNode
}

const SURFACE_ORDER: Record<HostablePluginPanelSurface, number> = { nav: 0, settings: 1 }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// The host already bounds depth at 16; this only keeps a bad payload off the stack.
const MAX_ICON_SVG_DEPTH = 32

function readIconSvgNode(value: unknown, depth: number): PluginPanelIconSvgNode | null {
  if (typeof value !== 'object' || value === null || depth > MAX_ICON_SVG_DEPTH) {
    return null
  }
  const node = value as { tag?: unknown; attributes?: unknown; children?: unknown }
  if (
    typeof node.tag !== 'string' ||
    !isPluginPanelIconSvgTag(node.tag) ||
    (depth === 0 && node.tag !== 'svg') ||
    typeof node.attributes !== 'object' ||
    node.attributes === null ||
    !Array.isArray(node.children)
  ) {
    return null
  }
  const attributes: Record<string, string> = {}
  for (const [name, attribute] of Object.entries(node.attributes)) {
    if (typeof attribute !== 'string') {
      return null
    }
    // Why: names become native props on the phone, so only the shared allow-list passes.
    if (isPluginPanelIconSvgAttribute(name, depth === 0)) {
      attributes[name] = attribute
    }
  }
  const children: PluginPanelIconSvgNode[] = []
  for (const child of node.children as unknown[]) {
    const parsed = readIconSvgNode(child, depth + 1)
    if (!parsed) {
      return null
    }
    children.push(parsed)
  }
  return { tag: node.tag, attributes, children }
}

function iconFields(
  icon: unknown,
  iconSvg: unknown
): Pick<HostablePluginPanel, 'icon' | 'iconSvg'> {
  const name = readString(icon)
  const tree = iconSvg === undefined ? null : readIconSvgNode(iconSvg, 0)
  return { ...(name ? { icon: name } : {}), ...(tree ? { iconSvg: tree } : {}) }
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
      const panel = raw as {
        id?: unknown
        title?: unknown
        surface?: unknown
        icon?: unknown
        iconSvg?: unknown
      }
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
        surface,
        ...iconFields(panel.icon, panel.iconSvg)
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
