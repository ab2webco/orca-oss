import { describe, expect, it } from 'vitest'
import {
  GAME_ROWS,
  gameRowFactsOf,
  shownGameRowGroups,
  shownGameRows,
  type GameRowFacts,
  type GameRowId
} from './orchestrator-game-row-visibility'

const facts = (over: Partial<GameRowFacts> = {}): GameRowFacts => ({
  page: 'project',
  look: 'game',
  style: 'figures',
  diorama: true,
  show: true,
  view: '2d-hd',
  band: true,
  render: 'hd',
  advisorPlugin: true,
  ...over
})

const shown = (over: Partial<GameRowFacts>): GameRowId[] => [...shownGameRows(facts(over))]

describe('the game row table', () => {
  it('lists every row once, in page order, each in one group', () => {
    const ids = GAME_ROWS.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'look',
      'style',
      'stylePreview',
      'diorama',
      'scene',
      'prs',
      'machines',
      'advisor',
      'arcade',
      'timezone',
      'show',
      'view',
      'hud',
      'rewards',
      'openLinks',
      'tracker',
      'band',
      'bandPreview',
      'render'
    ])
    expect(GAME_ROWS.map((row) => row.group)).toEqual([
      ...Array(10).fill('panel'),
      ...Array(6).fill('terminal'),
      ...Array(3).fill('band')
    ])
  })

  it('shows every row when everything is in use on a project', () => {
    expect(shown({})).toEqual(GAME_ROWS.map((row) => row.id))
  })

  it('hides what only the Game look reads when the look is Display or Plain', () => {
    const display = shown({ look: 'display', view: 'flat' })
    expect(display).not.toContain('style')
    expect(display).not.toContain('stylePreview')
    expect(display).not.toContain('diorama')
    expect(display).not.toContain('arcade')
    expect(display).not.toContain('scene')
    // Why Display keeps it: its day metrics follow the zone.
    expect(display).toContain('timezone')
    expect(shown({ look: 'plain', view: 'flat' })).not.toContain('timezone')
  })

  it('shows the diorama rows only for Figures drawn as the diorama', () => {
    expect(shown({ style: 'figures' })).toContain('diorama')
    expect(shown({ style: 'figures', diorama: false })).not.toContain('diorama')
    expect(shown({ style: 'office' })).not.toContain('diorama')
  })

  it('shows the terminal band group only for a pixel view', () => {
    for (const view of ['zen', '2d-classic', '2d-hd'] as const) {
      expect(shown({ view })).toContain('band')
    }
    for (const view of ['off', 'flat'] as const) {
      const rows = shown({ view })
      expect(rows).not.toContain('band')
      expect(rows).not.toContain('bandPreview')
      expect(rows).not.toContain('render')
    }
  })

  it('shows what the band draws only while the band is on', () => {
    const off = shown({ band: false })
    expect(off).toContain('band')
    expect(off).not.toContain('bandPreview')
    expect(off).not.toContain('render')
  })

  it("hides the mod's rows when no mod runs, and everything but the gate when the game is hidden", () => {
    const off = shown({ view: 'off', look: 'plain' })
    for (const id of ['hud', 'rewards', 'openLinks', 'tracker'] as const) {
      expect(off).not.toContain(id)
    }
    expect(off).toContain('view')
    const hidden = shown({ show: false, look: 'plain' })
    expect(hidden).toContain('show')
    expect(hidden).not.toContain('view')
    expect(hidden).not.toContain('band')
  })

  it('shows the HUD where it draws: in Flat, or a pixel view with the band on', () => {
    expect(shown({ view: 'flat', band: false })).toContain('hud')
    expect(shown({ view: '2d-classic', band: false })).not.toContain('hud')
    expect(shown({ view: '2d-classic', band: true })).toContain('hud')
  })

  it('keeps the scene for a band that draws it, whatever the panel look', () => {
    expect(shown({ look: 'plain', band: true })).toContain('scene')
    expect(shown({ look: 'plain', band: false })).not.toContain('scene')
  })

  it('keeps the zone for an hd band only, when the panel look is Plain', () => {
    expect(shown({ look: 'plain', render: 'hd' })).toContain('timezone')
    expect(shown({ look: 'plain', render: 'hd-compact' })).toContain('timezone')
    expect(shown({ look: 'plain', render: 'classic' })).not.toContain('timezone')
  })

  it('shows Advisor and Arcade only on the project page, Advisor only with its plugin', () => {
    expect(shown({ page: 'global' })).not.toContain('advisor')
    expect(shown({ page: 'global' })).not.toContain('arcade')
    expect(shown({ advisorPlugin: false })).not.toContain('advisor')
  })

  it('hides a group whose rows are all hidden', () => {
    expect([...shownGameRowGroups(facts({ view: 'flat' }))]).toEqual(['panel', 'terminal'])
    expect([...shownGameRowGroups(facts({}))]).toEqual(['panel', 'terminal', 'band'])
  })
})

describe('gameRowFactsOf', () => {
  it('reads the resolved layers: orca.yaml under this machine', () => {
    const got = gameRowFactsOf({
      page: 'project',
      layers: {
        global: { mode: 'flat' },
        project: { panel: { look: 'display' } },
        local: { mode: 'zen', band: true }
      },
      advisorPlugin: 'missing'
    })
    expect(got).toMatchObject({
      page: 'project',
      look: 'display',
      view: 'zen',
      band: true,
      show: true,
      advisorPlugin: false
    })
  })
})
