/** The Panel's sections a person can collapse, hide and move, in the order drawn before layouts. */
export const PANEL_SECTIONS = ['team', 'review', 'reviews', 'todo', 'actions'] as const
export type PanelSection = (typeof PANEL_SECTIONS)[number]

/** One `$.store` key for every game layout, so a later view mode adds a field, not a second key. */
export const PANEL_LAYOUT_KEY = 'panel-layout'
export const PANEL_LAYOUT_VERSION = 1
const PROJECTS_MAX = 50

export type FleetLayout = {
  order: readonly PanelSection[]
  collapsed: readonly PanelSection[]
  hidden: readonly PanelSection[]
}

export const DEFAULT_FLEET_LAYOUT: FleetLayout = {
  order: PANEL_SECTIONS,
  collapsed: [],
  hidden: []
}

export type MoveDirection = 'up' | 'down'

const ALIASES: Readonly<Record<string, PanelSection>> = {
  equipo: 'team',
  revision: 'review',
  revisión: 'review',
  prs: 'reviews',
  revisiones: 'reviews',
  'por-hacer': 'todo',
  tareas: 'todo',
  acciones: 'actions'
}

type StoredObject = Record<string, unknown>

const isRecord = (value: unknown): value is StoredObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSection = (value: unknown): value is PanelSection =>
  typeof value === 'string' && (PANEL_SECTIONS as readonly string[]).includes(value)

/** A section from a word a person typed: its id or its Spanish name. */
export const panelSectionOf = (word: string): PanelSection | null => {
  const asked = word.trim().toLowerCase()
  return isSection(asked) ? asked : (ALIASES[asked] ?? null)
}

/** Every worktree of one repo shares the layout: Orca's worktree ids read `<repoId>::<path>`. */
export const projectKeyOf = (worktreeId: string | undefined): string =>
  worktreeId?.split('::')[0] || 'default'

const sectionsOf = (value: unknown): PanelSection[] =>
  Array.isArray(value) ? [...new Set(value.filter(isSection))] : []

// Why each missing section goes after its default predecessor: a section a later build adds lands
// where that build draws it, not at the bottom.
const orderOf = (value: unknown): PanelSection[] => {
  const order = sectionsOf(value)
  PANEL_SECTIONS.forEach((section, at) => {
    if (!order.includes(section)) {
      const before = PANEL_SECTIONS.slice(0, at).findLast((one) => order.includes(one))
      order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, section)
    }
  })
  return order
}

/** A value with no version predates versions and reads as 1; null is one this build must not read. */
const storeOf = (value: unknown): StoredObject | null => {
  if (!isRecord(value) || !isRecord(value.projects)) {
    return null
  }
  const version = value.version ?? 1
  return version === PANEL_LAYOUT_VERSION ? value : null
}

/** The project's Fleet layout; the default for a missing, damaged or newer-build value. */
export const fleetLayoutOf = (stored: unknown, project: string): FleetLayout => {
  const projects = storeOf(stored)?.projects
  const fleet = isRecord(projects) && isRecord(projects[project]) ? projects[project].fleet : null
  if (!isRecord(fleet)) {
    return DEFAULT_FLEET_LAYOUT
  }
  return {
    order: orderOf(fleet.order),
    collapsed: sectionsOf(fleet.collapsed),
    hidden: sectionsOf(fleet.hidden)
  }
}

/**
 * The store value with the project's layout set, keeping every other key; null when a newer build
 * wrote it, so this one never overwrites what it cannot read.
 */
export const withFleetLayout = (
  stored: unknown,
  project: string,
  fleet: FleetLayout
): StoredObject | null => {
  const isNewer = isRecord(stored) && isRecord(stored.projects) && storeOf(stored) === null
  if (isNewer) {
    return null
  }
  const store = storeOf(stored) ?? { projects: {} }
  const projects = store.projects as StoredObject
  const { [project]: before, ...others } = projects
  const kept = Object.entries(others).slice(1 - PROJECTS_MAX)
  const entry = { ...(isRecord(before) ? before : {}), fleet }
  return {
    ...store,
    version: PANEL_LAYOUT_VERSION,
    projects: Object.fromEntries([...kept, [project, entry]])
  }
}

const without = (list: readonly PanelSection[], section: PanelSection) =>
  list.filter((one) => one !== section)

export const toggleSection = (layout: FleetLayout, section: PanelSection): FleetLayout => ({
  ...layout,
  collapsed: layout.collapsed.includes(section)
    ? without(layout.collapsed, section)
    : [...layout.collapsed, section]
})

export const hideSection = (layout: FleetLayout, section: PanelSection): FleetLayout =>
  layout.hidden.includes(section) ? layout : { ...layout, hidden: [...layout.hidden, section] }

/** Shown and expanded: a person who asks to see a section wants its rows. */
export const showSection = (layout: FleetLayout, section: PanelSection): FleetLayout => ({
  ...layout,
  hidden: without(layout.hidden, section),
  collapsed: without(layout.collapsed, section)
})

export const moveSection = (
  layout: FleetLayout,
  section: PanelSection,
  direction: MoveDirection
): FleetLayout => {
  const at = layout.order.indexOf(section)
  const to = direction === 'up' ? at - 1 : at + 1
  if (at === -1 || to < 0 || to >= layout.order.length) {
    return layout
  }
  const order = [...layout.order]
  ;[order[at], order[to]] = [order[to] as PanelSection, section]
  return { ...layout, order }
}
