import { afterEach, describe, expect, it } from 'vitest'

import { TILE_COLUMNS, TILE_ROWS, tileGridOf } from '../hooks/fleet-tiles'
import { hudGridOf } from '../hooks/fleet-hud'
import { GAME_LOCALES, isRasterText, localizedNameOf, setGameLocale } from '../hooks/game-strings'
import { ACTIONS } from '../hooks/quest-policy'
import { SCENE_ROWS, sceneGridOf } from '../hooks/scene'
import { SCENES, sceneOf, type SceneDefinition, type ScenePhase } from '../hooks/scenes/index'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { castOf } from '../hooks/scenes/cast-shape'
import { REFEREE } from '../hooks/advisor-art'
import { ORCHESTRATOR_GAME_BUILT_IN_SCENES } from '../../../../src/shared/orchestrator-game-config'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'
import { digest, glyphs } from './grid-digest'

afterEach(() => setGameLocale('en'))

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const PORTED = ['vigilante', 'jrpg', 'tamer'] as const
const scene = (id: string): SceneDefinition => sceneOf(id)
const englishNames = (one: SceneDefinition): string[] =>
  [...PHASES.map((phase) => one.cards[phase].name), one.teller.name].map((name) =>
    localizedNameOf(name, 'en')
  )

describe('built-in scenes', () => {
  it('ships quest and the three games of PR #32, the same ids Orca offers in Settings', () => {
    expect(Object.keys(SCENES)).toEqual(['quest', 'vigilante', 'jrpg', 'tamer'])
    expect(Object.keys(SCENES)).toEqual([...ORCHESTRATOR_GAME_BUILT_IN_SCENES])
    for (const id of PORTED) {
      expect(scene(id).id).toBe(id)
    }
  })

  it('casts each game as PR #32 named it', () => {
    expect(englishNames(scene('vigilante'))).toEqual([
      'Night Watch',
      'Detective',
      'Gadgeteer',
      'Mentor',
      'Rooftop Run',
      'Commissioner',
      'Narrator'
    ])
    expect(englishNames(scene('jrpg'))).toEqual([
      'Mercenary',
      'Mage',
      'Thief',
      'Healer',
      'Lancer',
      'Hero',
      'Chronicler'
    ])
    expect(englishNames(scene('tamer'))).toEqual([
      'Tamer',
      'Leafling',
      'Emberpup',
      'Voltbit',
      'Aquafin',
      'Starling',
      'Professor'
    ])
  })

  it.each(PORTED)('%s gives every phase its own sky, costume and card in every language', (id) => {
    const one = scene(id)
    for (const key of ['looks', 'costumes', 'cards'] as const) {
      expect(Object.keys(one[key]).sort()).toEqual([...PHASES].sort())
    }
    expect(new Set(PHASES.map((phase) => one.looks[phase].skyTop)).size).toBe(6)
    expect(new Set(PHASES.map((phase) => one.cards[phase].color)).size).toBe(6)
    expect(new Set(PHASES.map((phase) => one.costumes[phase].rows.join('|'))).size).toBe(6)
    for (const locale of GAME_LOCALES) {
      const shown = [...PHASES.map((phase) => one.cards[phase].name), one.teller.name].map((name) =>
        localizedNameOf(name, locale)
      )
      expect(new Set(shown).size).toBe(7)
    }
    for (const card of [...Object.values(one.cards), one.teller]) {
      expect(typeof card.name === 'object' && Object.keys(card.name).sort()).toEqual(
        [...GAME_LOCALES].sort()
      )
    }
  })

  it.each(PORTED)('%s passes both validators unchanged, foe and finale included', (id) => {
    const served = JSON.parse(JSON.stringify(scene(id))) as Record<string, unknown>
    const orca = parseOrchestratorGameScene(JSON.stringify(sceneFileOf(scene(id))), id)
    expect(orca.ok).toBe(true)
    expect(sceneDefinitionOf(served, id)).toEqual(scene(id))
    expect(orca.ok ? orca.definition : undefined).toEqual(scene(id))
    expect(scene(id).foe).toBeDefined()
    expect(scene(id).finale).toBeDefined()
  })

  it.each(PORTED)('%s keeps its finale to width-1 characters in every language', (id) => {
    const finale = scene(id).finale
    for (const locale of GAME_LOCALES) {
      expect(finale !== undefined && isRasterText(localizedNameOf(finale, locale))).toBe(true)
    }
  })
})

// Why: a file writes each look in its roster entry; Orca serves the looks apart as `characters`.
function sceneFileOf({ characters, ...rest }: SceneDefinition): Record<string, unknown> {
  const lookOf = (name: unknown) =>
    characters?.find((one) => JSON.stringify(one.name) === JSON.stringify(name)) ?? name
  return JSON.parse(JSON.stringify({ ...rest, roster: rest.roster?.map(lookOf) }))
}

describe('built-in scenes draw', () => {
  it('every phase, action, reaction and rest, at fixed ticks', () => {
    for (const id of PORTED) {
      for (const slot of PHASES) {
        const phase = slot === 'working' ? undefined : slot
        for (const tick of [0, 7, 31]) {
          const size = 60 * SCENE_ROWS
          expect(sceneGridOf(scene(id), phase, 60, tick, 'Editing scene.ts', 0)).toHaveLength(size)
          for (const action of ACTIONS) {
            const grid = sceneGridOf(scene(id), phase, 60, tick, 'x', 0, undefined, false, action)
            expect(grid).toHaveLength(size)
          }
          const reaction = { kind: 'level', age: 3 } as const
          expect(sceneGridOf(scene(id), phase, 60, tick, '', 0, reaction)).toHaveLength(size)
          expect(sceneGridOf(scene(id), phase, 60, tick, '', 0, undefined, true)).toHaveLength(size)
        }
      }
    }
  })

  it('paints each world its own way while quest keeps its frame', () => {
    const frames = Object.keys(SCENES).map((id) =>
      digest(sceneGridOf(scene(id), 'build', 60, 7, 'Editing quest.tsx', 0))
    )
    expect(frames[0]).toBe('f3652aeb')
    expect(new Set(frames).size).toBe(4)
    const nights = PORTED.map((id) => digest(sceneGridOf(scene(id), 'handoff', 60, 7, '', 0)))
    expect(new Set(nights).size).toBe(3)
  })

  it('a merge plays the finale in the launch language; nothing else does', () => {
    const merge = (id: string, action?: (typeof ACTIONS)[number]) =>
      glyphs(sceneGridOf(scene(id), 'pr', 80, 3, 'gh pr merge', 0, undefined, false, action))
    expect(merge('vigilante', 'merge')).toContain('CASE CLOSED')
    expect(merge('jrpg', 'merge')).toContain('VICTORY')
    expect(merge('tamer', 'merge')).toContain('CAUGHT!')
    expect(merge('vigilante', 'push')).not.toContain('CASE CLOSED')
    expect(merge('vigilante')).not.toContain('CASE CLOSED')
    expect(merge('quest', 'merge')).not.toMatch(/CLOSED|VICTORY|CAUGHT/)
    const resting = glyphs(
      sceneGridOf(scene('vigilante'), 'pr', 80, 3, '', 0, undefined, true, 'merge')
    )
    expect(resting).not.toContain('CASE CLOSED')
    setGameLocale('es')
    expect(merge('vigilante', 'merge')).toContain('CASO CERRADO')
  })

  it('a red CI brings the foe into the tile and into the HUD; quest stays as it was', () => {
    for (const id of PORTED) {
      const hurt = tileGridOf(scene(id), 'build', 'working', 3, 'hurt')
      expect(hurt).toHaveLength(TILE_COLUMNS * TILE_ROWS)
      expect(digest(hurt)).not.toBe(digest(tileGridOf(scene(id), 'build', 'working', 3)))
    }
    const foeColor = 0x7a3fb0
    const shows = (grid: number[][]) =>
      grid.some((cell) => cell[1] === foeColor || cell[2] === foeColor)
    expect(shows(tileGridOf(scene('tamer'), 'build', 'working', 3, 'hurt'))).toBe(true)
    expect(shows(tileGridOf(scene('tamer'), 'build', 'working', 3))).toBe(false)
    const member = [{ name: 'a', phase: 'pr', state: 'working', mood: 'hurt', says: 'x' }] as const
    // Tick 9: the foe's turn, between the hurt flashes that recolor the sprite.
    const frames = [0, 9].map((tick) => shows(hudGridOf(scene('tamer'), member, 60, tick)))
    expect(frames).toEqual([false, true])
    expect(digest(tileGridOf(scene('quest'), 'build', 'working', 9, 'hurt'))).toBe('c4e6c47c')
  })
})

describe('built-in casts', () => {
  const advisors = Object.values(SCENES).map((one) => one.cast?.advisor)

  it('dress Jev’s advisor for each world, each its own sprite, and pet no one but Clawd', () => {
    expect(
      Object.values(SCENES).map((one) => localizedNameOf(one.cast?.advisor?.name ?? '', 'en'))
    ).toEqual(['Wizard', 'Commissioner', 'Oracle', 'Professor'])
    expect(new Set(advisors.map((one) => JSON.stringify(one?.frames))).size).toBe(4)
    expect(advisors).not.toContainEqual(REFEREE)
    expect(Object.values(SCENES).every((one) => one.cast?.pet === undefined)).toBe(true)
  })

  it('name each advisor in every language, as the game re-reads a scene', () => {
    for (const one of Object.values(SCENES)) {
      const names = GAME_LOCALES.map((locale) =>
        localizedNameOf(one.cast?.advisor?.name ?? '', locale)
      )
      expect(names.every((name) => name.length > 0)).toBe(true)
      expect(castOf(JSON.parse(JSON.stringify(one.cast)))).toEqual(one.cast)
    }
  })

  it('give every advisor, the referee too, a body that raises a hand to stop a command', () => {
    for (const advisor of [...advisors, REFEREE]) {
      const idle = advisor?.frames[0] ?? []
      const stopped = advisor?.gestures?.stopped ?? []
      expect(stopped).toHaveLength(idle.length)
      expect(stopped.every((row) => row.length === idle[0]?.length)).toBe(true)
      expect(stopped).not.toEqual(idle)
    }
    expect(castOf(JSON.parse(JSON.stringify({ advisor: REFEREE })))?.advisor).toEqual(REFEREE)
  })
})
