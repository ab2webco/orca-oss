import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FLEET_LAYOUT,
  PANEL_LAYOUT_VERSION,
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

describe('panel layout', () => {
  it('defaults to today order with every section expanded and shown', () => {
    expect(DEFAULT_FLEET_LAYOUT).toEqual({
      order: ['team', 'review', 'reviews', 'todo', 'actions'],
      collapsed: [],
      hidden: []
    })
    expect(fleetLayoutOf(undefined, 'repo-1')).toEqual(DEFAULT_FLEET_LAYOUT)
  })

  it('keys a layout by the repo of the worktree, so every worktree of a project shares it', () => {
    expect(projectKeyOf('repo-1::/w/a')).toBe('repo-1')
    expect(projectKeyOf('repo-1::/w/b')).toBe('repo-1')
    expect(projectKeyOf(undefined)).toBe('default')
    expect(projectKeyOf('')).toBe('default')
  })

  it('falls back to the default for a corrupt value or one from a newer build', () => {
    for (const value of [null, 'x', 7, [], { version: 'one' }, { version: 1, projects: [] }]) {
      expect(fleetLayoutOf(value, 'repo-1')).toEqual(DEFAULT_FLEET_LAYOUT)
    }
    const newer = { ...stored({ order: ['todo'], collapsed: ['todo'], hidden: [] }), version: 99 }
    expect(fleetLayoutOf(newer, 'repo-1')).toEqual(DEFAULT_FLEET_LAYOUT)
  })

  it('drops unknown sections and puts a missing one back after its default predecessor', () => {
    const value = stored({
      order: ['todo', 'quests', 'team', 'todo'],
      collapsed: ['todo', 'quests', 5],
      hidden: 'team'
    })
    expect(fleetLayoutOf(value, 'repo-1')).toEqual({
      order: ['todo', 'actions', 'team', 'review', 'reviews'],
      collapsed: ['todo'],
      hidden: []
    })
  })

  it('reads a value written before versions as version 1', () => {
    const legacy = {
      projects: { 'repo-1': { fleet: { order: [], collapsed: ['team'], hidden: [] } } }
    }
    expect(fleetLayoutOf(legacy, 'repo-1').collapsed).toEqual(['team'])
  })

  it('toggles, hides, shows and moves one section at a time', () => {
    const collapsed = toggleSection(DEFAULT_FLEET_LAYOUT, 'todo')
    expect(collapsed.collapsed).toEqual(['todo'])
    expect(toggleSection(collapsed, 'todo').collapsed).toEqual([])
    const hidden = hideSection(DEFAULT_FLEET_LAYOUT, 'review')
    expect(hidden.hidden).toEqual(['review'])
    expect(hideSection(hidden, 'review')).toEqual(hidden)
    expect(showSection(hidden, 'review').hidden).toEqual([])
    // Showing a collapsed section opens it: "show" means the person wants to see it.
    expect(showSection(collapsed, 'todo').collapsed).toEqual([])
    expect(moveSection(DEFAULT_FLEET_LAYOUT, 'todo', 'up').order).toEqual([
      'team',
      'review',
      'todo',
      'reviews',
      'actions'
    ])
    expect(moveSection(DEFAULT_FLEET_LAYOUT, 'team', 'up')).toEqual(DEFAULT_FLEET_LAYOUT)
    expect(moveSection(DEFAULT_FLEET_LAYOUT, 'actions', 'down')).toEqual(DEFAULT_FLEET_LAYOUT)
  })

  it('writes one project and keeps the other projects and keys it does not know', () => {
    const before = {
      ...stored({ order: [], collapsed: ['team'], hidden: [] }, { view: 'flat' }),
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
    const next = withFleetLayout({ version: 1, projects }, 'repo-new', DEFAULT_FLEET_LAYOUT)
    const keys = Object.keys((next as { projects: object }).projects)
    expect(keys).toHaveLength(50)
    expect(keys[0]).toBe('repo-1')
    expect(keys.at(-1)).toBe('repo-new')
  })

  it('reads a section name in English or Spanish', () => {
    expect(panelSectionOf('TODO')).toBe('todo')
    expect(panelSectionOf('equipo')).toBe('team')
    expect(panelSectionOf('quests')).toBeNull()
  })
})
