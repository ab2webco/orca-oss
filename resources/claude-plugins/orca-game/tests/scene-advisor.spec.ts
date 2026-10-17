import { describe, expect, it } from 'vitest'

import { ADVISOR_PROP_WIDTH, advisorPropPixel, REFEREE } from '../hooks/advisor-art'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import { sceneGridOf, walkColumn } from '../hooks/scene'
import { advisorStageOf, type AdvisorPose } from '../hooks/scene-cast'
import { castOf } from '../hooks/scenes/cast-shape'
import { ADVISOR_GESTURES } from '../hooks/scenes/scene-definition'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import type { SceneAdvisor, SceneDefinition } from '../hooks/scenes/index'
import { digest } from './grid-digest'

const COLUMNS = 60
const GOLD = 0x0badc0
const HERO = 0x00fe01
const GOLEM: SceneAdvisor = {
  name: 'Golem',
  frames: [['.GGG.', 'GGGGG', 'GGGGG', 'G.G.G', '.G.G.']],
  gestures: { escalated: ['.GGG.', 'GRGRG', 'GGGGG', 'G.G.G', '.G.G.'] },
  colors: { G: GOLD, R: 0xd83a2e }
}
// A hero in one color no landscape uses, so its pixels can be found.
const SCENE: SceneDefinition = {
  ...QUEST_SCENE,
  id: 'test/advisor',
  costumes: {
    ...QUEST_SCENE.costumes,
    working: { ...QUEST_SCENE.costumes.working, colors: { O: HERO, E: HERO, H: HERO, B: HERO } }
  }
}

const pose = (patch: Partial<AdvisorPose> = {}): AdvisorPose => ({
  sprite: GOLEM,
  age: 0,
  bubble: '',
  ...patch
})

const columnsWith = (grid: number[][], color: number): number[] => {
  const found = new Set<number>()
  grid.forEach(([glyph, top, bottom], index) => {
    if (glyph === UPPER_HALF && (top === color || bottom === color)) {
      found.add(index % COLUMNS)
    }
  })
  return [...found].sort((a, b) => a - b)
}

const row0 = (grid: number[][]) =>
  grid
    .slice(0, COLUMNS)
    .map((cell) => String.fromCodePoint(cell[0] ?? 0))
    .join('')

describe('the advisor in the scene', () => {
  it('stands at the right edge, and the hero walks only the stage left of it', () => {
    const stage = advisorStageOf(COLUMNS, pose())
    expect(stage).toBe(COLUMNS - 5 - ADVISOR_PROP_WIDTH - 1)
    expect(
      columnsWith(
        sceneGridOf(SCENE, undefined, COLUMNS, 0, 'x', 0, undefined, false, undefined, pose()),
        GOLD
      )
    ).toEqual([54, 55, 56, 57, 58])
    for (let tick = 0; tick < 200; tick += 7) {
      const grid = sceneGridOf(
        SCENE,
        undefined,
        COLUMNS,
        tick,
        'x',
        0,
        undefined,
        false,
        undefined,
        pose()
      )
      const hero = columnsWith(grid, HERO)
      expect(hero[0]).toBe(walkColumn(stage, tick))
      expect(Math.max(...hero)).toBeLessThan(stage)
    }
  })

  it('takes no room at all without Jev', () => {
    const plain = sceneGridOf(SCENE, 'build', COLUMNS, 7, 'Editing quest.tsx', 0)
    expect(
      sceneGridOf(
        SCENE,
        'build',
        COLUMNS,
        7,
        'Editing quest.tsx',
        0,
        undefined,
        false,
        undefined,
        undefined
      )
    ).toEqual(plain)
    expect(digest(sceneGridOf(QUEST_SCENE, 'build', 60, 7, 'Editing quest.tsx', 0))).toBe(
      'f3652aeb'
    )
    expect(advisorStageOf(COLUMNS, undefined)).toBe(COLUMNS)
  })

  it('says its words in a bubble at the right edge, and the hero’s bubble stops short of it', () => {
    const grid = sceneGridOf(
      SCENE,
      undefined,
      COLUMNS,
      40,
      'Editing a very long file name that runs on',
      0,
      undefined,
      false,
      undefined,
      pose({ gesture: 'lowered', age: 20, bubble: 'Sonnet 5 · baja' })
    )
    const text = row0(grid)
    expect(text.endsWith('▐ Sonnet 5 · baja ▌')).toBe(true)
    const advisorLeft = text.lastIndexOf('▐')
    expect(text.indexOf('▌')).toBeLessThan(advisorLeft)
  })

  it('draws no bubble of its own when it has nothing to say', () => {
    const grid = sceneGridOf(
      SCENE,
      undefined,
      COLUMNS,
      40,
      'hi',
      0,
      undefined,
      false,
      undefined,
      pose({ gesture: 'approved' })
    )
    expect(row0(grid).split('▐')).toHaveLength(2)
  })

  it('wears its gesture body while the gesture plays, and holds the gesture prop', () => {
    const idle = sceneGridOf(
      SCENE,
      undefined,
      COLUMNS,
      0,
      '',
      0,
      undefined,
      false,
      undefined,
      pose()
    )
    const red = sceneGridOf(
      SCENE,
      undefined,
      COLUMNS,
      0,
      '',
      0,
      undefined,
      false,
      undefined,
      pose({ gesture: 'escalated', age: 2 })
    )
    expect(columnsWith(red, 0xd83a2e).some((x) => x >= 54)).toBe(true)
    expect(columnsWith(idle, 0xd83a2e).some((x) => x >= 54)).toBe(false)
    const propColumns = (grid: number[][]) =>
      grid.filter(
        (_cell, index) => index % COLUMNS >= 48 && index % COLUMNS < 53 && index >= COLUMNS
      )
    expect(propColumns(red)).not.toEqual(propColumns(idle))
  })
})

describe('gesture props', () => {
  it('give every gesture its own prop, inside the prop columns', () => {
    const frames = ADVISOR_GESTURES.map((gesture) => {
      const cells: (number | undefined)[] = []
      for (let y = 0; y < 10; y += 1) {
        for (let dx = 0; dx < ADVISOR_PROP_WIDTH; dx += 1) {
          cells.push(advisorPropPixel(gesture, dx, y, 4))
        }
      }
      return JSON.stringify(cells)
    })
    expect(new Set(frames).size).toBe(ADVISOR_GESTURES.length)
    const empty = JSON.stringify(Array(10 * ADVISOR_PROP_WIDTH).fill(null))
    expect(frames.every((one) => one !== empty)).toBe(true)
    expect(advisorPropPixel('lowered', ADVISOR_PROP_WIDTH, 5, 0)).toBeUndefined()
    expect(advisorPropPixel('lowered', -1, 5, 0)).toBeUndefined()
  })
})

describe('the referee', () => {
  it('is a cast advisor the game itself would accept from a scene file', () => {
    expect(castOf(JSON.parse(JSON.stringify({ advisor: REFEREE })))?.advisor).toEqual(REFEREE)
    expect(REFEREE.name).toMatchObject({ en: 'Referee', es: 'Árbitro' })
  })
})
