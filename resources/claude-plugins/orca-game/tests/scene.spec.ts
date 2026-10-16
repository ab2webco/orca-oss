import { describe, expect, it } from 'vitest'

import { ACTIONS } from '../hooks/quest-policy'
import { actionPixel, PROP_WIDTH } from '../hooks/action-props'
import { DEFAULT_SCENE_ID, SCENES, sceneOf } from '../hooks/scenes/index'
import {
  bubbleTextOf,
  restColumnOf,
  SCENE_ROWS,
  sceneColumnsOf,
  sceneGridOf,
  snoreOf
} from '../hooks/scene'
import { digest, glyphs } from './grid-digest'

const QUEST = sceneOf('quest')

const rowText = (grid: number[][], columns: number, row: number) =>
  grid
    .slice(row * columns, (row + 1) * columns)
    .map((cell) => String.fromCodePoint(cell[0] ?? 0))
    .join('')

describe('scene registry', () => {
  it('ships quest as the default and falls back to it for an unknown id', () => {
    expect(DEFAULT_SCENE_ID).toBe('quest')
    expect(Object.keys(SCENES)).toContain('quest')
    expect(sceneOf('nope')).toBe(QUEST)
    expect(sceneOf(undefined)).toBe(QUEST)
    expect(QUEST.id).toBe('quest')
  })

  it('every phase has its own sky, costume, card name and card color', () => {
    const phases = Object.keys(QUEST.looks).sort()
    expect(phases).toEqual(['build', 'docs', 'handoff', 'pr', 'verify', 'working'])
    expect(Object.keys(QUEST.costumes).sort()).toEqual(phases)
    expect(Object.keys(QUEST.cards).sort()).toEqual(phases)
    expect(new Set(Object.values(QUEST.looks).map((look) => look.skyTop)).size).toBe(6)
    expect(new Set(Object.values(QUEST.cards).map((card) => card.color)).size).toBe(6)
    expect(new Set(Object.values(QUEST.cards).map((card) => card.name)).size).toBe(6)
  })

  it('every costume fits the scene rows and names a color for each glyph', () => {
    const costumes = Object.values(QUEST.costumes)
    expect(new Set(costumes.map((costume) => costume.rows.join('|'))).size).toBe(costumes.length)
    for (const costume of costumes) {
      expect(costume.rows.every((row) => row.length === 10)).toBe(true)
      expect(costume.legs.every((row) => row.length === 10)).toBe(true)
      for (const glyph of [...costume.rows, ...costume.legs].join('').replace(/\./g, '')) {
        expect(costume.colors[glyph]).toBeDefined()
      }
    }
  })
})

describe('scene', () => {
  it('a bubble over Claude says what it does, and nothing else covers the landscape', () => {
    const columns = sceneColumnsOf(82)
    const grid = sceneGridOf(QUEST, 'build', columns, 5, 'Editing view.tsx')
    expect(columns).toBe(80)
    expect(grid).toHaveLength(columns * SCENE_ROWS)
    expect(rowText(grid, columns, SCENE_ROWS - 1)).toBe('▀'.repeat(columns))
    expect(rowText(grid, columns, 0)).toContain(' Editing view.tsx ')
    expect(rowText(sceneGridOf(QUEST, 'build', columns, 5), columns, 0)).toMatch(
      /▐ thinking\.{1,3} * ▌/
    )
    expect(
      rowText(sceneGridOf(QUEST, 'build', columns, 6, 'Editing view.tsx', 5), columns, 0)
    ).toContain(' Edi ')
    expect(bubbleTextOf('', 0, 0, 40)).not.toBe(bubbleTextOf('', 4, 0, 40))
    expect(grid[columns]?.[0]).toBe(0x2580)
  })

  it('a long caption is cut', () => {
    expect(rowText(sceneGridOf(QUEST, 'pr', 40, 0, 'x'.repeat(80)), 40, 0)).toContain('… ')
  })

  it('draws the same frame as the original quest art at a fixed tick', () => {
    expect(digest(sceneGridOf(QUEST, 'build', 60, 7, 'Editing quest.tsx', 0))).toBe('f3652aeb')
  })

  it('a finished character sits still with a snore instead of walking', () => {
    const at = (tick: number) =>
      sceneGridOf(QUEST, 'handoff', 60, tick, 'Moving to QA', 0, undefined, true)
    expect(at(3)).toEqual(at(3))
    const walking = (tick: number) => sceneGridOf(QUEST, 'handoff', 60, tick, 'Moving to QA', 0)
    expect(walking(0)).not.toEqual(walking(8))
    expect(glyphs(at(0))).toContain('z')
    expect(glyphs(at(0))).not.toContain('Moving to QA')
    expect(glyphs(at(10))).toContain('zzz')
    expect(snoreOf(0)).toBe('z  ')
    expect(restColumnOf(60)).toBe(16)
    const petted = sceneGridOf(QUEST, 'handoff', 60, 0, '', 0, { kind: 'pet', age: 1 }, true)
    expect(glyphs(petted)).not.toContain('z')
  })

  it('every action draws its own prop in front of the walking costume', () => {
    const frames = ACTIONS.map((action) => {
      const cells: (number | undefined)[] = []
      for (let y = 0; y < 10; y += 1) {
        for (let dx = 0; dx < PROP_WIDTH; dx += 1) {
          cells.push(actionPixel(action, dx, y, 4))
        }
      }
      return JSON.stringify(cells)
    })
    expect(new Set(frames).size).toBe(ACTIONS.length)
    expect(frames.every((one) => one !== JSON.stringify(Array(10 * PROP_WIDTH).fill(null)))).toBe(
      true
    )
    expect(actionPixel('read', PROP_WIDTH, 7, 0)).toBeUndefined()
    expect(sceneGridOf(QUEST, 'build', 60, 4, 'x', 0, undefined, false, 'edit')).not.toEqual(
      sceneGridOf(QUEST, 'build', 60, 4, 'x', 0)
    )
    expect(sceneGridOf(QUEST, 'build', 60, 4, 'x', 0, undefined, true, 'edit')).toEqual(
      sceneGridOf(QUEST, 'build', 60, 4, 'x', 0, undefined, true)
    )
  })
})
