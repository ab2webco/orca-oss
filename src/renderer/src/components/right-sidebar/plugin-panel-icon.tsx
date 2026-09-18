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
  type LucideIcon,
  type LucideProps
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { PluginPanelIconSvgNode } from '../../../../shared/plugins/plugin-panel-icon-svg'

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

/** Every plugin panel icon is a component with the lucide props shape, so the
 *  three surfaces (activity bar, Settings row, nav entry) paint it identically
 *  whether it came from the curated set or from the plugin's own file. */
export type PluginPanelIconComponent = ComponentType<LucideProps>

type IconSource = { icon?: string; iconSvg?: PluginPanelIconSvgNode }

// Why: a component created inline on every render remounts its subtree; keyed
// by the wire object so one fetch reuses one component identity.
const customIconCache = new WeakMap<PluginPanelIconSvgNode, PluginPanelIconComponent>()

/**
 * The ONE place a panel icon is resolved. El SVG ya viene saneado del main
 * (`plugin-panel-icon-svg.ts`); aca solo se pinta. Si el plugin no declaro
 * icono, declaro un nombre que no esta en el set, o su archivo no paso la
 * sanitizacion, sale el icono por defecto.
 */
export function resolvePluginPanelIcon(source: IconSource | undefined): PluginPanelIconComponent {
  if (source?.iconSvg) {
    return resolveCustomIcon(source.iconSvg)
  }
  return resolveCuratedIcon(source?.icon)
}

function resolveCuratedIcon(iconName: string | undefined): PluginPanelIconComponent {
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

function resolveCustomIcon(node: PluginPanelIconSvgNode): PluginPanelIconComponent {
  const cached = customIconCache.get(node)
  if (cached) {
    return cached
  }
  // El tamano lo manda la superficie: el archivo perdio width/height al
  // sanearse, asi que escala por CSS sobre su viewBox.
  function PluginPanelCustomIcon({ className }: LucideProps): React.JSX.Element {
    return (
      <svg {...reactAttributes(node)} className={className} aria-hidden="true" focusable="false">
        {renderIconChildren(node)}
      </svg>
    )
  }
  customIconCache.set(node, PluginPanelCustomIcon)
  return PluginPanelCustomIcon
}

// La ruta desde la raiz es la identidad estable de un nodo: el arbol ya vino
// saneado del main y nunca se reordena ni crece, asi que dos hermanos con el
// mismo tag y los mismos atributos siguen siendo nodos distintos.
function renderIconChildren(node: PluginPanelIconSvgNode, parentPath = ''): React.JSX.Element[] {
  const painted: React.JSX.Element[] = []
  let position = 0
  for (const child of node.children) {
    const path = `${parentPath}/${position}.${child.tag}`
    const Tag = child.tag
    painted.push(
      <Tag key={path} {...reactAttributes(child)}>
        {renderIconChildren(child, path)}
      </Tag>
    )
    position += 1
  }
  return painted
}

// React only understands the camelCase spelling of the hyphenated SVG
// presentation attributes; the wire keeps the canonical SVG ones.
function reactAttributes(node: PluginPanelIconSvgNode): Record<string, string> {
  const mapped: Record<string, string> = {}
  for (const [name, value] of Object.entries(node.attributes)) {
    mapped[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value
  }
  return mapped
}
