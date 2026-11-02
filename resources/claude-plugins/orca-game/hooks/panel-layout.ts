/** The Panel's sections, in the order drawn before layouts. Each one is a widget a person can add or remove. */
export const PANEL_SECTIONS = ['team', 'review', 'reviews', 'todo', 'actions', 'metrics'] as const
export type PanelSection = (typeof PANEL_SECTIONS)[number]

/** What a new Panel shows; every other section waits in the catalog until a person adds it. */
const DEFAULT_SHOWN: readonly PanelSection[] = ['team', 'reviews']

/** One `$.store` key for every game layout, so a later view mode adds a field, not a second key. */
export const PANEL_LAYOUT_KEY = 'panel-layout'
// Why 2: `shown` replaces `hidden`, so a section a later build adds starts in the catalog.
export const PANEL_LAYOUT_VERSION = 2
const PROJECTS_MAX = 50

export type FleetLayout = {
  order: readonly PanelSection[]
  collapsed: readonly PanelSection[]
  shown: readonly PanelSection[]
}

export const DEFAULT_FLEET_LAYOUT: FleetLayout = {
  order: PANEL_SECTIONS,
  collapsed: [],
  shown: DEFAULT_SHOWN
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
  acciones: 'actions',
  metricas: 'metrics',
  métricas: 'metrics'
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

/** The sections of `order` that are in `sections`, so the shown list always reads in Panel order. */
const inOrder = (
  order: readonly PanelSection[],
  sections: readonly PanelSection[]
): PanelSection[] => order.filter((one) => sections.includes(one))

// The sections a version 1 Panel had; one added since starts in the catalog.
const VERSION_1_SECTIONS: readonly PanelSection[] = ['team', 'review', 'reviews', 'todo', 'actions']

// Why: a version 1 Panel drew every section it did not hide, so the upgrade keeps exactly that.
const upgradedFleetOf = (fleet: StoredObject): StoredObject => {
  const hidden = sectionsOf(fleet.hidden)
  return {
    order: fleet.order,
    collapsed: fleet.collapsed,
    shown: VERSION_1_SECTIONS.filter((one) => !hidden.includes(one))
  }
}

/**
 * The store as version 2, a version 1 store upgraded project by project; null for a newer build's
 * value or a damaged one. A value with no version predates versions and reads as 1.
 */
const storeOf = (value: unknown): StoredObject | null => {
  if (!isRecord(value) || !isRecord(value.projects)) {
    return null
  }
  const version = value.version ?? 1
  if (version === PANEL_LAYOUT_VERSION) {
    return value
  }
  if (version !== 1) {
    return null
  }
  const projects = Object.fromEntries(
    Object.entries(value.projects).map(([key, entry]) => [
      key,
      isRecord(entry) && isRecord(entry.fleet)
        ? { ...entry, fleet: upgradedFleetOf(entry.fleet) }
        : entry
    ])
  )
  return { ...value, version: PANEL_LAYOUT_VERSION, projects }
}

/** The project's Fleet layout; the default for a missing, damaged or newer-build value. */
export const fleetLayoutOf = (stored: unknown, project: string): FleetLayout => {
  const projects = storeOf(stored)?.projects
  const fleet = isRecord(projects) && isRecord(projects[project]) ? projects[project].fleet : null
  if (!isRecord(fleet)) {
    return DEFAULT_FLEET_LAYOUT
  }
  const order = orderOf(fleet.order)
  return {
    order,
    collapsed: sectionsOf(fleet.collapsed),
    shown: inOrder(order, Array.isArray(fleet.shown) ? sectionsOf(fleet.shown) : DEFAULT_SHOWN)
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

/** The sections a person can add: every section the Panel knows and does not show, in Panel order. */
export const catalogOf = (layout: FleetLayout): readonly PanelSection[] =>
  layout.order.filter((one) => !layout.shown.includes(one))

const without = (list: readonly PanelSection[], section: PanelSection) =>
  list.filter((one) => one !== section)

export const toggleSection = (layout: FleetLayout, section: PanelSection): FleetLayout => ({
  ...layout,
  collapsed: layout.collapsed.includes(section)
    ? without(layout.collapsed, section)
    : [...layout.collapsed, section]
})

export const hideSection = (layout: FleetLayout, section: PanelSection): FleetLayout => ({
  ...layout,
  shown: inOrder(layout.order, without(layout.shown, section))
})

/** Shown and expanded: a person who asks to see a section wants its rows. */
export const showSection = (layout: FleetLayout, section: PanelSection): FleetLayout => ({
  ...layout,
  shown: inOrder(layout.order, [...layout.shown, section]),
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
