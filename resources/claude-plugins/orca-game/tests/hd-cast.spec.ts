import { describe, expect, it } from 'vitest'

import { outlineOf } from '../hooks/hd-sprite'
import { CLOUD } from '../hooks/hd-thought'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import type { AdvisorPose } from '../hooks/scene-cast'
import { hdSceneGridOf, type HdSceneInput } from '../hooks/scene-hd'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import type { SceneAdvisor, SceneDefinition, ScenePet } from '../hooks/scenes/index'
import { glyphs } from './grid-digest'

const COLUMNS = 100
const WOLF_GREY = 0x0d0e0f
const GOLD = 0x0badc0
const HERO = 0x00fe01

const WOLF: ScenePet = {
  name: { en: 'Wolf' },
  frames: [
    ['W...W', 'WWWWW', 'WEWEW', '.WWW.', '.W.W.'],
    ['W...W', 'WWWWW', 'WEWEW', '.WWW.', 'W...W']
  ],
  happy: ['W...W', 'WWWWW', 'WHWHW', '.WWW.', '.W.W.'],
  colors: { W: WOLF_GREY, E: 0x1a1a1a, H: 0xff5a8a }
}
const GOLEM: SceneAdvisor = {
  name: 'Golem',
  frames: [['.GGG.', 'GGGGG', 'GGGGG', 'G.G.G', '.G.G.']],
  gestures: { escalated: ['.GGG.', 'GRGRG', 'GGGGG', 'G.G.G', '.G.G.'] },
  colors: { G: GOLD, R: 0xd83a2e }
}
const SCENE: SceneDefinition = {
  ...QUEST_SCENE,
  id: 'test/cast',
  cast: { pet: WOLF },
  costumes: {
    ...QUEST_SCENE.costumes,
    working: { ...QUEST_SCENE.costumes.working, colors: { O: HERO, E: HERO, H: HERO, B: HERO } }
  }
}

const input = (patch: Partial<HdSceneInput> = {}): HdSceneInput => ({
  scene: SCENE,
  phase: undefined,
  columns: COLUMNS,
  rows: 10,
  tick: 41,
  caption: 'Editing scene.ts',
  since: 0,
  ...patch
})

const pose = (patch: Partial<AdvisorPose> = {}): AdvisorPose => ({
  sprite: GOLEM,
  age: 0,
  bubble: '',
  ...patch
})

const columnsWith = (grid: number[][], colors: readonly number[]): number[] => {
  const found = new Set<number>()
  grid.forEach((cell, index) => {
    if (cell[0] === UPPER_HALF && colors.some((one) => cell[1] === one || cell[2] === one)) {
      found.add(index % COLUMNS)
    }
  })
  return [...found].sort((a, b) => a - b)
}

const colorsOf = (grid: number[][]): Set<number> =>
  new Set(grid.flatMap((cell) => (cell[0] === UPPER_HALF ? [cell[1] ?? 0, cell[2] ?? 0] : [])))

describe('the pet in hd', () => {
  it('trails the hero outlined in ink from its own palette, keeping its colours', () => {
    const grid = hdSceneGridOf(input())
    const colors = colorsOf(grid)
    expect(colors.has(WOLF_GREY)).toBe(true)
    expect(colors.has(outlineOf(WOLF.colors))).toBe(true)
  })

  it('wears its happy face among hearts when Pet is pressed', () => {
    const grid = hdSceneGridOf(input({ reaction: { kind: 'pet', age: 2 } }))
    expect(colorsOf(grid).has(0xff5a8a)).toBe(true)
    expect(grid.some((cell) => cell[0] === 0x2665)).toBe(true)
  })
})

describe('Jev’s advisor in hd', () => {
  it('stands at the right edge outlined in its own ink, only while it is there', () => {
    const grid = hdSceneGridOf(input({ advisor: pose() }))
    const golem = columnsWith(grid, [GOLD])
    expect(Math.max(...golem)).toBeGreaterThanOrEqual(COLUMNS - 4)
    expect(colorsOf(grid).has(outlineOf(GOLEM.colors))).toBe(true)
    expect(columnsWith(hdSceneGridOf(input()), [GOLD])).toEqual([])
  })

  it('keeps the hero and its pet short of the advisor on every step', () => {
    for (let tick = 0; tick < 400; tick += 7) {
      const grid = hdSceneGridOf(input({ tick, caption: '', advisor: pose() }))
      const golem = Math.min(...columnsWith(grid, [GOLD]))
      expect(Math.max(...columnsWith(grid, [HERO, WOLF_GREY]))).toBeLessThan(golem - 1)
    }
  })

  it('holds out its gesture’s prop and says its words in a cloud of its own', () => {
    const grid = hdSceneGridOf(
      input({ advisor: pose({ gesture: 'escalated', bubble: 'escalated to Opus', age: 10 }) })
    )
    expect(colorsOf(grid).has(0xd83a2e)).toBe(true)
    expect(glyphs(grid)).toContain('escalated to Opus')
    expect(glyphs(grid)).toContain('Editing scene.ts')
  })

  it('never lets the hero’s cloud, hearts or a floating text cover the advisor’s words', () => {
    for (let tick = 0; tick < 200; tick += 9) {
      const grid = hdSceneGridOf(
        input({
          tick,
          caption: 'Reading a rather long file name that wants the whole row.ts',
          reaction: { kind: 'pet', age: tick % 20 },
          event: { kind: 'merged', text: '#42 merged!', age: 1 },
          advisor: pose({ bubble: 'kept the model', age: 10 })
        })
      )
      expect(glyphs(grid)).toContain('kept the model')
      const words = grid.flatMap((cell, i) =>
        cell[0] !== UPPER_HALF && cell[2] === CLOUD ? [i] : []
      )
      expect(words.length).toBeGreaterThan(0)
    }
  })
})
