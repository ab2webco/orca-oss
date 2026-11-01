import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FLEET_LAYOUT,
  PANEL_LAYOUT_VERSION,
  catalogOf,
  fleetLayoutOf,
  hideSection,
  moveSection,
  panelSectionOf,
  projectKeyOf,
  showSection,
  toggleSection,
  withFleetLayout
} from '../hooks/panel-layout'

const stored = (fleet: unknown, extra: Record<string, unknown> = {}) => ({
  version: PANEL_LAYOUT_VERSION,
  projects: { 'repo-1': { fleet } },
  ...extra
})

// Version 1 as the build before ORCA-773 wrote it: `hidden` listed what the Panel did not draw.
const VERSION_1_STORE = {
  version: 1,
  projects: {
    'repo-1': {
      fleet: {
        order: ['todo', 'team', 'review', 'reviews', 'actions'],
        collapsed: ['todo'],
        hidden: ['review']
      }
    },
    'repo-2': {
      fleet: { order: ['team', 'review', 'reviews', 'todo', 'actions'], collapsed: [], hidden: [] }
    }
  }
}

describe('panel layout', () => {
  it('shows Team and My PRs by default and keeps the rest in the catalog', () => {
    expect(DEFAULT_FLEET_LAYOUT).toEqual({
      order: ['team', 'review', 'reviews', 'todo', 'actions', 'metrics'],
      collapsed: [],
      shown: ['team', 'reviews']
    })
    expect(fleetLayoutOf(undefined, 'repo-1')).toEqual(DEFAULT_FLEET_LAYOUT)
    expect(catalogOf(DEFAULT_FLEET_LAYOUT)).toEqual(['review', 'todo', 'actions', 'metrics'])
  })

  it('keys a layout by the repo of the worktree, so every worktree of a project shares it', () => {
    expect(projectKeyOf('repo-1::/w/a')).toBe('repo-1')
    expect(projectKeyOf('repo-1::/w/b')).toBe('repo-1')
    expect(projectKeyOf(undefined)).toBe('default')
    expect(projectKeyOf('')).toBe('default')
  })

  it('falls back to the default for a corrupt value or one from a newer build', () => {
    for (const value of [null, 'x', 7, [], { version: 'one' }, { version: 2, projects: [] }]) {
      expect(fleetLayoutOf(value, 'repo-1')).toEqual(DEFAULT_FLEET_LAYOUT)
    }
    const newer = { ...stored({ order: ['todo'], collapsed: ['todo'], shown: [] }), version: 3 }
    expect(fleetLayoutOf(newer, 'repo-1')).toEqual(DEFAULT_FLEET_LAYOUT)
  })

  it('drops unknown sections and puts a missing one back after its default predecessor', () => {
    const value = stored({
      order: ['todo', 'quests', 'team', 'todo'],
      collapsed: ['todo', 'quests', 5],
      shown: 'team'
    })
    expect(fleetLayoutOf(value, 'repo-1')).toEqual({
      order: ['todo', 'actions', 'metrics', 'team', 'review', 'reviews'],
      collapsed: ['todo'],
      shown: ['team', 'reviews']
    })
  })

  it('a section a later build adds starts in the catalog, not on the Panel', () => {
    const value = stored({ order: ['team'], collapsed: [], shown: ['team'] })
    const layout = fleetLayoutOf(value, 'repo-1')
    expect(layout.shown).toEqual(['team'])
    expect(catalogOf(layout)).toEqual(['review', 'reviews', 'todo', 'actions', 'metrics'])
  })

  it('reads a version 1 layout and keeps every section it showed, and only those', () => {
    expect(fleetLayoutOf(VERSION_1_STORE, 'repo-1')).toEqual({
      order: ['todo', 'team', 'review', 'reviews', 'actions', 'metrics'],
      collapsed: ['todo'],
      shown: ['todo', 'team', 'reviews', 'actions']
    })
    expect(fleetLayoutOf(VERSION_1_STORE, 'repo-2').shown).toEqual([
      'team',
      'review',
      'reviews',
      'todo',
      'actions'
    ])
    expect(fleetLayoutOf(VERSION_1_STORE, 'repo-3')).toEqual(DEFAULT_FLEET_LAYOUT)
  })

  it('reads a value written before versions as version 1', () => {
    const legacy = {
      projects: { 'repo-1': { fleet: { order: [], collapsed: ['team'], hidden: [] } } }
    }
    expect(fleetLayoutOf(legacy, 'repo-1').collapsed).toEqual(['team'])
  })

  it('toggles, shows, hides and moves one section at a time', () => {
    const collapsed = toggleSection(DEFAULT_FLEET_LAYOUT, 'team')
    expect(collapsed.collapsed).toEqual(['team'])
    expect(toggleSection(collapsed, 'team').collapsed).toEqual([])
    const shown = showSection(DEFAULT_FLEET_LAYOUT, 'todo')
    expect(shown.shown).toEqual(['team', 'reviews', 'todo'])
    expect(showSection(shown, 'todo')).toEqual(shown)
    const hidden = hideSection(DEFAULT_FLEET_LAYOUT, 'reviews')
    expect(hidden.shown).toEqual(['team'])
    expect(hideSection(hidden, 'reviews')).toEqual(hidden)
    // Showing a collapsed section opens it: "show" means the person wants to see its rows.
    const opened = showSection(toggleSection(DEFAULT_FLEET_LAYOUT, 'team'), 'team')
    expect(opened.collapsed).toEqual([])
    expect(moveSection(DEFAULT_FLEET_LAYOUT, 'todo', 'up').order).toEqual([
      'team',
      'review',
      'todo',
      'reviews',
      'actions',
      'metrics'
    ])
    expect(moveSection(DEFAULT_FLEET_LAYOUT, 'team', 'up')).toEqual(DEFAULT_FLEET_LAYOUT)
    expect(moveSection(DEFAULT_FLEET_LAYOUT, 'metrics', 'down')).toEqual(DEFAULT_FLEET_LAYOUT)
  })

  it('writes one project as version 2 and keeps the other projects and keys it does not know', () => {
    const before = {
      ...stored({ order: [], collapsed: ['team'], shown: ['team'] }, { view: 'flat' }),
      projects: { 'repo-2': { fleet: DEFAULT_FLEET_LAYOUT, view: 'zen' } }
    }
    const next = withFleetLayout(before, 'repo-1', toggleSection(DEFAULT_FLEET_LAYOUT, 'todo'))
    expect(next).toEqual({
      version: PANEL_LAYOUT_VERSION,
      view: 'flat',
      projects: {
        'repo-2': { fleet: DEFAULT_FLEET_LAYOUT, view: 'zen' },
        'repo-1': { fleet: { ...DEFAULT_FLEET_LAYOUT, collapsed: ['todo'] } }
      }
    })
  })

  it('upgrades every project of a version 1 store on the first write and keeps what each showed', () => {
    const next = withFleetLayout(VERSION_1_STORE, 'repo-1', DEFAULT_FLEET_LAYOUT) as {
      version: number
      projects: Record<string, { fleet: unknown }>
    }
    expect(next.version).toBe(PANEL_LAYOUT_VERSION)
    expect(next.projects['repo-2']?.fleet).toEqual({
      order: ['team', 'review', 'reviews', 'todo', 'actions'],
      collapsed: [],
      shown: ['team', 'review', 'reviews', 'todo', 'actions']
    })
  })

  it('never writes over a newer build and starts over from a corrupt value', () => {
    const newer = { version: 99, projects: { 'repo-1': { fleet: 'future' } } }
    expect(withFleetLayout(newer, 'repo-1', DEFAULT_FLEET_LAYOUT)).toBeNull()
    expect(withFleetLayout('garbage', 'repo-1', DEFAULT_FLEET_LAYOUT)).toEqual({
      version: PANEL_LAYOUT_VERSION,
      projects: { 'repo-1': { fleet: DEFAULT_FLEET_LAYOUT } }
    })
  })

  it('keeps the 50 most recently changed projects', () => {
    const projects = Object.fromEntries(
      Array.from({ length: 50 }, (_, at) => [`repo-${at}`, { fleet: DEFAULT_FLEET_LAYOUT }])
    )
    const next = withFleetLayout({ version: 2, projects }, 'repo-new', DEFAULT_FLEET_LAYOUT)
    const keys = Object.keys((next as { projects: object }).projects)
    expect(keys).toHaveLength(50)
    expect(keys[0]).toBe('repo-1')
    expect(keys.at(-1)).toBe('repo-new')
  })

  it('reads a section name in English or Spanish', () => {
    expect(panelSectionOf('TODO')).toBe('todo')
    expect(panelSectionOf('equipo')).toBe('team')
    expect(panelSectionOf('Métricas')).toBe('metrics')
    expect(panelSectionOf('metricas')).toBe('metrics')
    expect(panelSectionOf('quests')).toBeNull()
  })
})
