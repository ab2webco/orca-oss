import { afterEach, describe, expect, it } from 'vitest'

import { menuChipsOf } from '../hooks/band-chips'
import { setGameLocale, stringsOf, GAME_LOCALES } from '../hooks/game-strings'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import { restColumnOf, SCENE_ROWS, sceneGridOf, walkColumn } from '../hooks/scene'
import { PET_TRAIL_TICKS, petColumnOf } from '../hooks/scene-cast'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import type { SceneDefinition, ScenePet } from '../hooks/scenes/index'

afterEach(() => setGameLocale('en'))

const FUR = 0x123456
const BLUSH = 0xff00ff
const PET: ScenePet = {
  name: { en: 'Wolf', es: 'Lobo' },
  frames: [
    ['W...W', 'WWWWW', 'WEWEW', '.WWW.', '.W.W.'],
    ['W...W', 'WWWWW', 'WEWEW', '.WWW.', 'W...W']
  ],
  happy: ['W...W', 'WWWWW', 'WHWHW', '.WWW.', '.W.W.'],
  colors: { W: FUR, E: 0x1a1a1a, H: BLUSH }
}
const WITH_PET: SceneDefinition = { ...QUEST_SCENE, id: 'test/pet', cast: { pet: PET } }
const COLUMNS = 60
// Hearts sprinkled over the petted one, not the ♥ inside the bubble's text.
const HEART = 0xff5a8a

// Every pixel of a frame, keyed "x,y", from the half blocks that pack two pixels per cell.
const pixelsOf = (grid: number[][], columns: number): Map<string, number> => {
  const pixels = new Map<string, number>()
  grid.forEach(([glyph, top = 0, bottom = 0], index) => {
    const x = index % columns
    const row = Math.floor(index / columns)
    if (glyph === UPPER_HALF) {
      pixels.set(`${x},${row * 2}`, top)
      pixels.set(`${x},${row * 2 + 1}`, bottom)
    }
  })
  return pixels
}

const columnsWith = (grid: number[][], color: number): number[] =>
  [
    ...new Set(
      [...pixelsOf(grid, COLUMNS)]
        .filter(([, one]) => one === color)
        .map(([at]) => Number(at.split(',')[0]))
    )
  ].sort((a, b) => a - b)

const rowsWith = (grid: number[][], color: number): number[] =>
  [
    ...new Set(
      [...pixelsOf(grid, COLUMNS)]
        .filter(([, one]) => one === color)
        .map(([at]) => Number(at.split(',')[1]))
    )
  ].sort((a, b) => a - b)

const heartsAt = (grid: number[][]): number[] =>
  grid.slice(0, COLUMNS).flatMap((cell, x) => (cell[0] === 0x2665 && cell[1] === HEART ? [x] : []))

describe('the scene pet', () => {
  it('walks on the ground behind the hero, along the hero path', () => {
    const tick = 60
    const at = petColumnOf(PET, COLUMNS, tick, false)
    expect(at).toBe(walkColumn(COLUMNS, tick - PET_TRAIL_TICKS))
    const grid = sceneGridOf(WITH_PET, undefined, COLUMNS, tick, 'Editing')
    expect(columnsWith(grid, FUR)).toEqual([at, at + 1, at + 2, at + 3, at + 4])
    expect(rowsWith(grid, FUR)).toEqual([4, 5, 6, 7, 8])
  })

  it('sits beside a resting hero', () => {
    const grid = sceneGridOf(WITH_PET, 'handoff', COLUMNS, 3, '', 0, undefined, true)
    const at = restColumnOf(COLUMNS) - 6
    expect(petColumnOf(PET, COLUMNS, 3, true)).toBe(at)
    expect(columnsWith(grid, FUR)[0]).toBe(at)
  })

  it('leaves a scene without a pet exactly as it was drawn before', () => {
    const plain = sceneGridOf(QUEST_SCENE, 'build', COLUMNS, 7, 'Editing quest.tsx', 0)
    const empty = { ...QUEST_SCENE, cast: {} }
    expect(sceneGridOf(empty, 'build', COLUMNS, 7, 'Editing quest.tsx', 0)).toEqual(plain)
  })

  it('Pet hearts the pet, which shows its happy frame and hops, while the hero stays put', () => {
    const tick = 60
    const at = petColumnOf(PET, COLUMNS, tick, false)
    const petted = sceneGridOf(WITH_PET, undefined, COLUMNS, tick, '', 0, { kind: 'pet', age: 1 })
    expect(columnsWith(petted, BLUSH)).toEqual([at + 1, at + 3])
    expect(rowsWith(petted, FUR)).toEqual([3, 4, 5, 6, 7])
    const hearts = heartsAt(petted)
    expect(hearts.length).toBeGreaterThan(0)
    expect(hearts.every((x) => x >= at && x < at + 5)).toBe(true)
    const row0 = petted.slice(0, COLUMNS).map((cell) => String.fromCodePoint(cell[0] ?? 0))
    expect(row0.join('').indexOf('▐')).toBe(at + 4)
    const walk = walkColumn(COLUMNS, tick)
    const hero = (grid: number[][]) =>
      grid.filter((_cell, index) => {
        const x = index % COLUMNS
        return index >= COLUMNS && x >= walk && x < walk + 10
      })
    const calm = sceneGridOf(WITH_PET, undefined, COLUMNS, tick, '', 0)
    expect(hero(petted)).toEqual(hero(calm))
    expect(petted).toHaveLength(COLUMNS * SCENE_ROWS)
  })

  it('without a pet, Pet still hearts the hero as before', () => {
    const petted = sceneGridOf(QUEST_SCENE, undefined, COLUMNS, 60, '', 0, { kind: 'pet', age: 1 })
    const walk = walkColumn(COLUMNS, 60)
    expect(heartsAt(petted).every((x) => x >= walk && x < walk + 10)).toBe(true)
  })
})

describe('the Pet button', () => {
  const petLabel = (scene: SceneDefinition) =>
    menuChipsOf(scene).find((chip) => chip.key === 'band-pet')?.labels[0]

  it('names the scene pet, and is plain Pet without one', () => {
    expect(petLabel(QUEST_SCENE)).toBe('♥ Pet')
    expect(petLabel(WITH_PET)).toBe('♥ Pet Wolf')
    setGameLocale('es')
    expect(petLabel(QUEST_SCENE)).toBe('♥ Mimar')
    expect(petLabel(WITH_PET)).toBe('♥ Mimar a Lobo')
  })

  it('has its words in every language', () => {
    for (const locale of GAME_LOCALES) {
      const { text } = stringsOf(locale)
      expect(text.pet.length).toBeGreaterThan(0)
      expect(text.petNamed('Steve')).toContain('Steve')
      expect(text.petNamed('Steve')).not.toBe(text.pet)
    }
  })
})
