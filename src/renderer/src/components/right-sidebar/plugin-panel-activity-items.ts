import {
  Activity,
  BarChart3,
  Bell,
  Blocks,
  Book,
  Bot,
  Bug,
  Calendar,
  Cloud,
  Code,
  Database,
  FileText,
  Flag,
  Folder,
  Gauge,
  Globe,
  Hammer,
  Layers,
  Lightbulb,
  Package,
  Plug,
  Puzzle,
  Rocket,
  Star,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { isWorktreeSurfacePanel, type ActivePluginPanel } from '@/store/plugin-panels'
import type { ActivityBarItem } from './activity-bar-buttons'

// Why: importing lucide's full `icons` map would bundle every icon and defeat
// tree-shaking, so plugin manifests pick from this curated set (fallback: Plug).
const PLUGIN_PANEL_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  barchart3: BarChart3,
  bell: Bell,
  blocks: Blocks,
  book: Book,
  bot: Bot,
  bug: Bug,
  calendar: Calendar,
  cloud: Cloud,
  code: Code,
  database: Database,
  filetext: FileText,
  flag: Flag,
  folder: Folder,
  gauge: Gauge,
  globe: Globe,
  hammer: Hammer,
  layers: Layers,
  lightbulb: Lightbulb,
  package: Package,
  plug: Plug,
  puzzle: Puzzle,
  rocket: Rocket,
  star: Star,
  terminal: Terminal,
  wrench: Wrench,
  zap: Zap
}

export function resolvePluginPanelIcon(iconName: string | undefined): LucideIcon {
  if (!iconName) {
    return Plug
  }
  // Accept both lucide naming styles ('file-text' and 'FileText').
  const normalized = iconName.replaceAll('-', '').toLowerCase()
  // Own-key only: a manifest icon named `constructor` must not resolve to an
  // inherited member and crash the sidebar with a non-component "icon".
  return Object.hasOwn(PLUGIN_PANEL_ICONS, normalized)
    ? (PLUGIN_PANEL_ICONS[normalized] ?? Plug)
    : Plug
}

/** Maps active plugin panel contributions onto right-sidebar activity items.
 *  Filtering happens here and not in `collectActivePluginPanels` because the
 *  Settings surface resolves its panel through that same collection. */
export function getPluginPanelActivityItems(
  panels: ActivePluginPanel[],
  panelErrors: Readonly<Record<string, true>> = {}
): ActivityBarItem[] {
  return panels.filter(isWorktreeSurfacePanel).map((panel) => ({
    id: panel.tabKey,
    icon: resolvePluginPanelIcon(panel.icon),
    // Why: panel titles come from plugin manifests, not the app catalog, so
    // they render untranslated by design.
    title: panel.title,
    shortcut: '',
    ...(panelErrors[panel.tabKey] ? { statusIndicator: 'failure' as const } : {})
  }))
}
