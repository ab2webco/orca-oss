import { createElement, type ComponentType, type ReactElement } from 'react'
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
  Inbox,
  Layers,
  Lightbulb,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  Plug,
  Puzzle,
  Rocket,
  Star,
  Terminal,
  Users,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react-native'
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg'
import type {
  PluginPanelIconSvgNode,
  PluginPanelIconSvgTag
} from '../../../src/shared/plugins/plugin-panel-icon-svg'

// Mirrors the desktop curated set in src/renderer/src/components/right-sidebar/plugin-panel-icon.tsx.
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
  inbox: Inbox,
  layers: Layers,
  lightbulb: Lightbulb,
  mail: Mail,
  messagecircle: MessageCircle,
  messagesquare: MessageSquare,
  package: Package,
  plug: Plug,
  puzzle: Puzzle,
  rocket: Rocket,
  star: Star,
  terminal: Terminal,
  users: Users,
  wrench: Wrench,
  zap: Zap
}

type SvgElementProps = Record<string, string | number>

// Why: the react-native-svg element props differ per tag; the tree only carries allow-listed strings.
const SVG_ELEMENTS = {
  svg: Svg,
  g: G,
  path: Path,
  circle: Circle,
  ellipse: Ellipse,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  rect: Rect
} as unknown as Record<PluginPanelIconSvgTag, ComponentType<SvgElementProps>>

type Props = {
  icon?: string
  iconSvg?: PluginPanelIconSvgNode
  size: number
  color: string
}

/** A plugin panel's icon: its own sanitized svg, else a curated lucide name, else Plug. */
export function PluginPanelIcon({ icon, iconSvg, size, color }: Props): ReactElement {
  if (iconSvg) {
    return createElement(
      SVG_ELEMENTS.svg,
      { ...nativeAttributes(iconSvg, color), width: size, height: size, color },
      ...paintChildren(iconSvg, color, '')
    )
  }
  const Icon = resolveCuratedIcon(icon)
  return <Icon size={size} color={color} />
}

function resolveCuratedIcon(iconName: string | undefined): LucideIcon {
  if (!iconName) {
    return Plug
  }
  // Accept both lucide naming styles ('file-text' and 'FileText').
  const normalized = iconName.replaceAll('-', '').toLowerCase()
  // Own-key only: `constructor` must not resolve to an inherited member.
  return Object.hasOwn(PLUGIN_PANEL_ICONS, normalized)
    ? (PLUGIN_PANEL_ICONS[normalized] ?? Plug)
    : Plug
}

// The path from the root is a node's stable key: the tree never reorders.
function paintChildren(
  node: PluginPanelIconSvgNode,
  color: string,
  parentPath: string
): ReactElement[] {
  return node.children.map((child, position) => {
    const path = `${parentPath}/${position}.${child.tag}`
    return createElement(
      SVG_ELEMENTS[child.tag],
      { ...nativeAttributes(child, color), key: path },
      ...paintChildren(child, color, path)
    )
  })
}

// react-native-svg takes camelCase props; the wire keeps the SVG spelling.
function nativeAttributes(node: PluginPanelIconSvgNode, color: string): SvgElementProps {
  const mapped: SvgElementProps = {}
  for (const [name, value] of Object.entries(node.attributes)) {
    mapped[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] =
      value === 'currentColor' ? color : value
  }
  return mapped
}
