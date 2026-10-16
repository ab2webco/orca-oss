import { describe, expect, it } from 'vitest'

import { HUD_ROWS, hudGridOf, xpTextOf } from '../hooks/fleet-hud'
import { setGameLocale } from '../hooks/game-strings'
import { isRestingOf } from '../hooks/party-sprites'
import { TILE_COLUMNS, TILE_ROWS, tileGridOf } from '../hooks/fleet-tiles'
import { levelOf } from '../hooks/rewards'
import { sceneOf } from '../hooks/scenes/index'
import { digest, glyphs } from './grid-digest'

const QUEST = sceneOf('quest')

const party = [
  { name: 'CIN-860', phase: 'build', state: 'waiting', mood: 'none', says: 'implementing' },
  { name: 'CIN-944', phase: 'pr', state: 'working', mood: 'hurt', says: 'impl PR' },
  { name: 'CIN-862', phase: 'handoff', state: 'idle', mood: 'cheer', says: 'in QA' }
] as const

describe('tiles', () => {
  it('draw the same frames as the original quest art at a fixed tick', () => {
    expect(digest(tileGridOf(QUEST, 'verify', 'working', 9))).toBe('3b2ada5f')
    expect(digest(tileGridOf(QUEST, 'build', 'working', 9, 'hurt'))).toBe('c4e6c47c')
    expect(digest(tileGridOf(QUEST, 'pr', 'idle', 9, 'cheer'))).toBe('38b8038a')
    expect(tileGridOf(QUEST, 'verify', 'working', 9)).toHaveLength(TILE_COLUMNS * TILE_ROWS)
  })

  it('a waiting member blinks a !, a hurt one flashes, a cheering one rests', () => {
    expect(glyphs(tileGridOf(QUEST, 'build', 'waiting', 0))).toBe('!')
    expect(glyphs(tileGridOf(QUEST, 'build', 'waiting', 4))).toBe('')
    expect(digest(tileGridOf(QUEST, 'build', 'working', 0, 'hurt'))).not.toBe(
      digest(tileGridOf(QUEST, 'build', 'working', 0))
    )
    expect(glyphs(tileGridOf(QUEST, 'pr', 'working', 0, 'cheer'))).toBe('z')
    expect(glyphs(tileGridOf(QUEST, 'build', 'idle', 0))).toBe('z')
  })
})

describe('hud', () => {
  it('draws the party with one ! per waiting member and the hero raising it too', () => {
    expect(hudGridOf(QUEST, party, 90, 4)).toHaveLength(90 * HUD_ROWS)
    expect(glyphs(hudGridOf(QUEST, party, 90, 0)).split('!').length - 1).toBe(3)
    expect(glyphs(hudGridOf(QUEST, party, 90, 4)).split('!').length - 1).toBe(1)
    expect(glyphs(hudGridOf(QUEST, party, 90, 4))).toContain('CI is red')
    expect(glyphs(hudGridOf(QUEST, party, 90, 4))).toContain('×')
  })

  it("paints the frame and sky from a scene's own hud palette", () => {
    const hud = {
      skyTop: 0x5c94fc,
      skyBottom: 0x5c94fc,
      frame: 0xfcd800,
      text: 0xfcfcfc,
      dim: 0x2038ec,
      star: 0x5c94fc
    }
    const grid = hudGridOf({ ...QUEST, hud }, [], 90, 4)
    expect(grid[0]).toEqual([0x2580, 0xfcd800, 0xfcd800])
    expect(grid[90 * 2]).toEqual([0x2580, 0xfcd800, 0xfcd800])
    // Why row 3, column 85: below the "no party" lines and past the hero, so only sky shows.
    expect(grid[85 + 90 * 3]).toEqual([0x2580, 0x5c94fc, 0x5c94fc])
    expect(hudGridOf(QUEST, [], 90, 4)[0]?.[1]).toBe(0xc9a24a)
  })

  it('shows the level bar only when rewards give it one', () => {
    expect(glyphs(hudGridOf(QUEST, party, 90, 4, { level: levelOf(250) }))).toContain(
      'Lv 2 ■■■□□ 150/200 XP'
    )
    expect(glyphs(hudGridOf(QUEST, party, 90, 4))).not.toContain('XP')
    expect(xpTextOf(levelOf(130))).toBe('Lv 2 □□□□□ 30/200 XP')
  })

  it('draws the same HUD frame as the original quest art, and pins the level bar over it', () => {
    const acting = [
      { ...party[0], action: 'read' },
      { ...party[1], action: 'push' },
      party[2]
    ] as const
    expect(digest(hudGridOf(QUEST, acting, 90, 4))).toBe('9e35f468')
    expect(digest(hudGridOf(QUEST, acting, 90, 0, { isDemo: true }))).toBe('56cd3324')
    expect(digest(hudGridOf(QUEST, party, 90, 4, { level: levelOf(130) }))).toBe('8c4630ff')
  })

  // Why: the HUD is a Raster, so a language drawn two columns wide keeps its English art.
  it('writes the HUD in Spanish, and in English for a language a Raster cannot draw', () => {
    try {
      setGameLocale('es')
      expect(glyphs(hudGridOf(QUEST, party, 90, 4))).toContain('CI en rojo')
      expect(glyphs(hudGridOf(QUEST, [], 80, 0))).toContain('Aún no hay grupo.')
      expect(xpTextOf(levelOf(130))).toBe('Nv 2 □□□□□ 30/200 XP')
      setGameLocale('ja')
      expect(glyphs(hudGridOf(QUEST, [], 80, 0))).toContain('No party yet.')
    } finally {
      setGameLocale('en')
    }
  })

  it('an empty party says how teammates join, and the demo wears a tag', () => {
    expect(glyphs(hudGridOf(QUEST, [], 80, 0))).toContain('No party yet.')
    expect(glyphs(hudGridOf(QUEST, [], 80, 0, { isDemo: true }))).toContain('DEMO')
    expect(glyphs(hudGridOf(QUEST, [], 80, 0))).not.toContain('DEMO')
  })

  it('idle and done members rest; the hero rests while nothing works', () => {
    expect(isRestingOf('idle', 'none')).toBe(true)
    expect(isRestingOf('working', 'cheer')).toBe(true)
    expect(isRestingOf('working', 'none')).toBe(false)
    expect(isRestingOf('waiting', 'cheer')).toBe(false)
    const idle = [{ name: 'a', phase: 'pr', state: 'idle', says: 'idle' }] as const
    expect(glyphs(hudGridOf(QUEST, idle, 60, 0)).split('z').length - 1).toBe(2)
    expect(
      glyphs(hudGridOf(QUEST, idle, 60, 0, { isHeroWorking: true })).split('z').length - 1
    ).toBe(1)
  })

  it('a working member carries its action prop', () => {
    const one = [
      { name: 'a', phase: 'build', state: 'working', says: 'x', action: 'push' }
    ] as const
    expect(hudGridOf(QUEST, one, 60, 4)).not.toEqual(
      hudGridOf(QUEST, [{ ...one[0], action: undefined }], 60, 4)
    )
  })
})
