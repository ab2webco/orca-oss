import { describe, expect, it } from 'vitest'

import { rasterGlyphsOf } from '../hooks/game-strings'
import { daylightAt } from '../hooks/hd-daylight'
import { LEAD_GOLD, STATE_RING } from '../hooks/hd-party'
import { costumeSpriteOf, ringOf } from '../hooks/hd-sprite'
import { drawThought, trailOf } from '../hooks/hd-thought'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import { sceneGridOf } from '../hooks/scene'
import { HD_ROWS, hdSceneGridOf, type HdSceneInput } from '../hooks/scene-hd'
import { sceneOf } from '../hooks/scenes/index'
import { glyphs } from './grid-digest'

const QUEST = sceneOf('quest')
const CLOUD = 0xf4f4f0

const input = (patch: Partial<HdSceneInput> = {}): HdSceneInput => ({
  scene: QUEST,
  phase: 'build',
  columns: 120,
  rows: 10,
  tick: 41,
  caption: 'Editing scene.ts',
  since: 0,
  ...patch
})

const colorsOf = (grid: number[][]): Set<number> =>
  new Set(grid.flatMap((cell) => (cell[0] === UPPER_HALF ? [cell[1] ?? 0, cell[2] ?? 0] : [])))

const lumaOf = (grid: number[][]): number =>
  grid
    .filter((cell) => cell[0] === UPPER_HALF)
    .reduce((sum, cell) => sum + ((cell[1] ?? 0) & 255) + (((cell[1] ?? 0) >> 8) & 255), 0)

describe('day and night in the hd scene', () => {
  it('darkens the night, with stars and a moon', () => {
    const day = hdSceneGridOf(input({ light: daylightAt(12) }))
    const night = hdSceneGridOf(input({ light: daylightAt(22) }))
    expect(lumaOf(night)).toBeLessThan(lumaOf(day) * 0.8)
    const lit = colorsOf(night)
    expect(lit.has(0xf5f3c8) || lit.has(0xe8ecff)).toBe(true)
    expect(colorsOf(day).has(0xf5f3c8)).toBe(false)
  })

  it('tells dawn from dusk by where the sun stands', () => {
    expect(hdSceneGridOf(input({ light: daylightAt(6) }))).not.toEqual(
      hdSceneGridOf(input({ light: daylightAt(18) }))
    )
  })
})

describe('the thought cloud', () => {
  it('puts the words on a cloud with a highlight, a shadow and a trail that bobs', () => {
    const grid = hdSceneGridOf(input({ tick: 40 }))
    expect(glyphs(grid)).toContain('Editing scene.ts')
    const behind = grid.filter((cell) => cell[0] !== UPPER_HALF && cell[2] === CLOUD)
    expect(behind.length).toBeGreaterThan(10)
    const colors = colorsOf(grid)
    expect(colors.has(0xffffff)).toBe(true)
    expect(colors.has(0xc9ccd6)).toBe(true)
    expect(trailOf(10, 8, 40)).not.toEqual(trailOf(10, 8, 48))
  })

  it('draws the trail where it bobs to, toward the hero', () => {
    const columns = 120
    const blank = () => Array.from({ length: 10 * columns }, () => [UPPER_HALF, 0x102030, 0x102030])
    for (const tick of [40, 48]) {
      const grid = blank()
      const box = drawThought(grid, 'hello there', 'working', 0, {
        columns,
        rows: 10,
        tick,
        left: 30,
        limit: columns,
        row: 2,
        headRight: 0,
        headTop: 99,
        floor: 19
      })
      const bottom = ((box?.row ?? 0) + (box?.lines ?? 0)) * 2
      for (const [x, y] of trailOf(box?.left ?? 0, bottom, tick)) {
        const cell = grid[Math.floor(y / 2) * columns + x]
        expect([0xffffff, CLOUD]).toContain(cell?.[y % 2 === 0 ? 1 : 2])
      }
    }
  })

  it('passes every drawn text through the glyph filter', () => {
    expect(rasterGlyphsOf('a​b́ 🚀 漢')).toEqual(['a', 'b', ' ', '?', ' ', '?'])
    const grid = hdSceneGridOf(input({ caption: 'ship 🚀 now' }))
    expect(glyphs(grid)).toContain('ship ? now')
    expect(glyphs(grid)).not.toContain('🚀')
  })
})

describe('team reactions', () => {
  const textOf = (patch: Partial<HdSceneInput>) => glyphs(hdSceneGridOf(input(patch)))

  it('floats +N XP, a needs-you and a merge up from the hero', () => {
    expect(textOf({ event: { kind: 'xp', text: '+20 XP', age: 2 } })).toContain('+20 XP')
    expect(textOf({ event: { kind: 'needs', text: 'ana needs you!', age: 2 } })).toContain(
      'ana needs you!'
    )
    expect(textOf({ event: { kind: 'merged', text: '#42 merged!', age: 2 } })).toContain(
      '#42 merged!'
    )
    const needs = hdSceneGridOf(input({ event: { kind: 'needs', text: 'ana needs you!', age: 2 } }))
    expect(needs.some((cell) => cell[0] === 'a'.codePointAt(0) && cell[1] === 0xff4a4a)).toBe(true)
  })

  it('flashes the merge white and shakes a red CI by one column', () => {
    const still = hdSceneGridOf(input({ tick: 40 }))
    const merged = hdSceneGridOf(input({ tick: 40, event: { kind: 'merged', text: 'm', age: 0 } }))
    expect(lumaOf(merged)).toBeGreaterThan(lumaOf(still))
    const red = hdSceneGridOf(
      input({ tick: 40, event: { kind: 'fail', text: 'CI is red', age: 0 } })
    )
    expect(red.some((cell) => ((cell[1] ?? 0) >> 16) - ((cell[1] ?? 0) & 255) > 120)).toBe(true)
    const columns = 120
    const row = 9
    const shaking = hdSceneGridOf(input({ tick: 40, event: { kind: 'fail', text: 'x', age: 6 } }))
    const shifted = shaking.slice(row * columns + 1, row * columns + 60)
    const original = still.slice(row * columns, row * columns + 59)
    expect(shifted).toEqual(original)
    const after = hdSceneGridOf(input({ tick: 40, event: { kind: 'fail', text: 'x', age: 12 } }))
    expect(after.slice(row * columns, (row + 1) * columns)).toEqual(
      still.slice(row * columns, (row + 1) * columns)
    )
  })

  it('skips a floating text wider than the scene', () => {
    const grid = hdSceneGridOf(
      input({ columns: 6, event: { kind: 'merged', text: '#4242 merged!', age: 2 } })
    )
    expect(grid).toHaveLength(60)
    expect(glyphs(grid)).not.toContain('merged')
  })

  it('never floats a text over any row of the thought cloud', () => {
    for (const columns of [40, 80, 120]) {
      for (let age = 0; age < 18; age += 1) {
        const grid = hdSceneGridOf(
          input({
            columns,
            tick: 41 + age,
            caption: '',
            event: { kind: 'merged', text: '#42 merged!', age }
          })
        )
        const cloud = grid.flatMap((cell, i) =>
          cell[0] !== UPPER_HALF && cell[2] === CLOUD ? [i] : []
        )
        const rows = cloud.map((i) => Math.floor(i / columns))
        const xs = cloud.map((i) => i % columns)
        const box = [
          Math.min(...rows) - 1,
          Math.max(...rows) + 1,
          Math.min(...xs) - 3,
          Math.max(...xs) + 3
        ]
        const floating = grid.flatMap((cell, i) =>
          cell[0] !== UPPER_HALF && cell[1] === 0xffffff ? [i] : []
        )
        const onCloud = floating.filter(
          (i) =>
            Math.floor(i / columns) >= (box[0] ?? 0) &&
            Math.floor(i / columns) <= (box[1] ?? 0) &&
            i % columns >= (box[2] ?? 0) &&
            i % columns <= (box[3] ?? 0)
        )
        expect([columns, age, onCloud.length]).toEqual([columns, age, 0])
      }
    }
  })
})

describe('the party and the lead', () => {
  it('follows the hero outlined in its state colour inked dark, with a ! over the one waiting, and classic draws none of it', () => {
    const party = [{ key: 'a', phase: 'build' as const, state: 'waiting' as const }]
    const grid = hdSceneGridOf(input({ party, isResting: true }))
    const ring = ringOf(costumeSpriteOf(QUEST.costumes.build, 0, true), STATE_RING.waiting)
    expect(colorsOf(grid).has(ring)).toBe(true)
    expect(colorsOf(grid).has(STATE_RING.waiting)).toBe(false)
    expect(grid.some((cell) => cell[0] === 0x21 && cell[1] !== 0x23232b)).toBe(true)
    expect(hdSceneGridOf(input({ isResting: true })).some((cell) => cell[0] === 0x21)).toBe(false)
    const classic = sceneGridOf(QUEST, 'build', 120, 41, 'x', 0, undefined, true)
    expect(classic.flat().includes(STATE_RING.waiting)).toBe(false)
  })

  it('walks a marching member in from the right edge', () => {
    const party = [{ key: 'a', phase: 'build' as const, state: 'working' as const }]
    const marches = new Map([['a', { kind: 'in' as const, at: 41 }]])
    const arriving = hdSceneGridOf(input({ party, marches, tick: 41 }))
    const settled = hdSceneGridOf(input({ party, marches, tick: 41 + 30 }))
    const ring = ringOf(costumeSpriteOf(QUEST.costumes.build, 0, false), STATE_RING.working)
    const ringColumns = (grid: number[][]) =>
      grid.flatMap((cell, i) => (cell.includes(ring) ? [i % 120] : []))
    expect(Math.min(...ringColumns(arriving))).toBeGreaterThan(Math.max(...ringColumns(settled)))
  })

  it('crowns the lead and labels it under its feet', () => {
    const crowned = hdSceneGridOf(input({ lead: 'Lead', rows: HD_ROWS }))
    expect(colorsOf(crowned).has(LEAD_GOLD)).toBe(true)
    const bottom = crowned.slice((HD_ROWS - 1) * 120)
    expect(glyphs(bottom)).toContain('Lead')
    expect(colorsOf(hdSceneGridOf(input({ rows: HD_ROWS }))).has(LEAD_GOLD)).toBe(false)
  })

  it('lights a campfire by the resting hero, with embers', () => {
    const grid = hdSceneGridOf(input({ isResting: true }))
    const colors = colorsOf(grid)
    expect([0xfff1a0, 0xffd24a, 0xff9a2e, 0xe0521e].some((flame) => colors.has(flame))).toBe(true)
  })
})
