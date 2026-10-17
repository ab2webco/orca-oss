import { describe, expect, it } from 'vitest'

import { REFEREE } from '../hooks/advisor-art'
import { advisorTileCellsOf, advisorTileGridOf } from '../hooks/advisor-tile'
import { TILE_COLUMNS, TILE_ROWS, tileGridOf } from '../hooks/fleet-tiles'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import { QUEST_SCENE } from '../hooks/scenes/quest'
import type { SceneAdvisor } from '../hooks/scenes/index'

const GOLD = 0x0badc0
const RED = 0xd83a2e
const GOLEM: SceneAdvisor = {
  name: 'Golem',
  frames: [['.GGG.', 'GGGGG', 'GGGGG', 'G.G.G', '.G.G.']],
  gestures: { lowered: ['.GGG.', 'GRGRG', 'GGGGG', 'G.G.G', '.G.G.'] },
  colors: { G: GOLD, R: RED }
}

// Pixel (x, y) of a half-block tile grid; y counts pixel rows, two per cell.
const pixelOf = (grid: number[][], x: number, y: number): number | undefined =>
  grid[Math.floor(y / 2) * TILE_COLUMNS + x]?.[y % 2 === 0 ? 1 : 2]

describe('advisorTileGridOf', () => {
  it('is a member tile in size, on the member tiles’ wall and floor', () => {
    const grid = advisorTileGridOf(GOLEM, null, 0)
    const member = tileGridOf(QUEST_SCENE, 'working', 'idle', 0)
    expect(grid).toHaveLength(TILE_COLUMNS * TILE_ROWS)
    expect(grid.every((cell) => cell[0] === UPPER_HALF)).toBe(true)
    expect(pixelOf(grid, TILE_COLUMNS - 2, 0)).toBe(pixelOf(member, TILE_COLUMNS - 2, 0))
    expect(pixelOf(grid, TILE_COLUMNS - 2, 7)).toBe(pixelOf(member, TILE_COLUMNS - 2, 7))
  })

  it('stands the idle frame on the floor from the second column, as a member stands', () => {
    const grid = advisorTileGridOf(GOLEM, null, 0)
    // Five rows tall on an eight-pixel tile whose last row is floor: rows 2 to 6.
    expect(pixelOf(grid, 1, 2)).not.toBe(GOLD)
    expect(pixelOf(grid, 2, 2)).toBe(GOLD)
    expect(pixelOf(grid, 1, 3)).toBe(GOLD)
    expect(pixelOf(grid, 2, 3)).toBe(GOLD)
    expect(pixelOf(grid, 2, 6)).toBe(GOLD)
    expect(pixelOf(grid, 0, 3)).not.toBe(GOLD)
    expect(pixelOf(grid, 6, 3)).not.toBe(GOLD)
    expect(pixelOf(grid, 2, 7)).not.toBe(GOLD)
  })

  it('takes the pose of the latest gesture the cast defines, else stays idle', () => {
    expect(pixelOf(advisorTileGridOf(GOLEM, 'lowered', 0), 2, 3)).toBe(RED)
    expect(advisorTileGridOf(GOLEM, 'raised', 0)).toEqual(advisorTileGridOf(GOLEM, null, 0))
    expect(advisorTileGridOf(REFEREE, 'escalated', 0)).toEqual(advisorTileGridOf(REFEREE, null, 0))
  })

  it('draws the same cells while the idle frame does not change, so the gate sends nothing', () => {
    // The referee's first three idle frames are one drawing; the fourth blinks.
    expect(advisorTileCellsOf(REFEREE, null, 8)).toBe(advisorTileCellsOf(REFEREE, null, 0))
    expect(advisorTileCellsOf(REFEREE, null, 24)).not.toBe(advisorTileCellsOf(REFEREE, null, 0))
    expect(advisorTileCellsOf(GOLEM, 'lowered', 30)).toBe(advisorTileCellsOf(GOLEM, 'lowered', 0))
  })
})
