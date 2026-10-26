import { describe, expect, it } from 'vitest'

import { runnerOf, runnerStartOf, type RunnerState } from '../hooks/arcade-runner'
import { ARCADE_RUNNER } from '../hooks/arcade-runner-data'
import {
  ARCADE_ROWS,
  ARCADE_SHAPE_MAX_COLUMNS,
  ARCADE_SHAPE_MAX_HEIGHT,
  arcadeGridOf,
  arcadeShapesOf
} from '../hooks/arcade-runner-frame'
import { glyphs } from './grid-digest'
import { SCENES, sceneOf } from '../hooks/scenes/index'

const ROWS = ARCADE_ROWS
// 1440, 768, 390 and 320 px at 9 px a cell.
const WIDTHS = [160, 85, 43, 35]

const gridFor = (scene = sceneOf('quest'), state?: RunnerState, columns = 85) => {
  const runner = runnerOf(ARCADE_RUNNER, arcadeShapesOf(ARCADE_RUNNER, scene.looks.working))
  return arcadeGridOf({
    scene,
    runner,
    state: state ?? runnerStartOf(runner, 1),
    columns,
    rows: ROWS,
    tick: 0
  })
}

describe("the runner's obstacles", () => {
  it("cuts every built-in scene's own decoration down to a jumpable size", () => {
    for (const scene of Object.values(SCENES)) {
      for (const look of Object.values(scene.looks)) {
        const [own] = arcadeShapesOf(ARCADE_RUNNER, look)
        expect(own!.heights.length).toBeGreaterThan(0)
        expect(own!.heights.length).toBeLessThanOrEqual(ARCADE_SHAPE_MAX_COLUMNS)
        expect(Math.max(...own!.heights)).toBeGreaterThan(0)
        expect(Math.max(...own!.heights)).toBeLessThanOrEqual(ARCADE_SHAPE_MAX_HEIGHT)
        const footing = own!.heights.map((_, column) => own!.pixelAt(column, 0, 0))
        expect(footing.some((one) => one !== undefined)).toBe(true)
      }
    }
  })

  it('draws a sprite obstacle glyph for pixel, its rows standing on the ground', () => {
    const rock = arcadeShapesOf(ARCADE_RUNNER, sceneOf('quest').looks.working)[1]!
    expect(rock.heights).toEqual([2, 3, 3, 2])
    expect(rock.weight).toBe(0.35)
    expect(rock.pixelAt(0, 0, 0)).toBe(0x6b6b73)
    expect(rock.pixelAt(1, 0, 0)).toBe(0x9a9aa3)
    expect(rock.pixelAt(0, 2, 0)).toBeUndefined()
  })

  it('keeps only the sprite obstacles for a scene with no decoration', () => {
    const bare = { ...sceneOf('quest').looks.working, plantKind: 'none' as const }
    expect(arcadeShapesOf(ARCADE_RUNNER, bare).map((one) => one.heights)).toEqual([[2, 3, 3, 2]])
  })
})

describe('a runner frame', () => {
  it('fills the band at every supported width', () => {
    for (const columns of WIDTHS) {
      const grid = gridFor(sceneOf('vigilante'), undefined, columns)
      expect(grid).toHaveLength(columns * ROWS)
      expect(grid.every((cell) => cell.length === 3 && cell.every(Number.isFinite))).toBe(true)
    }
  })

  it('draws an obstacle in its own columns only', () => {
    const start = runnerStartOf(runnerOf(ARCADE_RUNNER, []), 1)
    const clear = gridFor(undefined, start)
    const shown = gridFor(undefined, { ...start, obstacles: [{ x: 40, shape: 0 }] })
    const changed = new Set<number>()
    clear.forEach((cell, i) => {
      if (cell.join() !== shown[i]!.join()) {
        changed.add(i % 85)
      }
    })
    expect(changed.size).toBeGreaterThan(0)
    // Its columns, its outline either side and the rim past that.
    expect([...changed].every((x) => x >= 38 && x <= 41 + ARCADE_SHAPE_MAX_COLUMNS)).toBe(true)
  })

  it('lifts the hero off the ground while it jumps', () => {
    const start = runnerStartOf(runnerOf(ARCADE_RUNNER, []), 1)
    const ground = gridFor(undefined, start)
    const air = gridFor(undefined, { ...start, jumpMs: ARCADE_RUNNER.jump.ms / 2 })
    const lastRow = (grid: number[][]) => grid.slice(-85 * 3, -85 * 3 + 14).map((c) => c.join())
    expect(lastRow(air)).not.toEqual(lastRow(ground))
  })

  it('shows the score in the top row and a caption when one is given', () => {
    const scene = sceneOf('quest')
    const runner = runnerOf(ARCADE_RUNNER, arcadeShapesOf(ARCADE_RUNNER, scene.looks.working))
    const state = { ...runnerStartOf(runner, 1), score: 1234 }
    const grid = arcadeGridOf({
      scene,
      runner,
      state,
      columns: 85,
      rows: ROWS,
      tick: 0,
      caption: 'Paused'
    })
    const text = glyphs(grid)
    expect(glyphs(grid.slice(0, 85))).toContain('1234')
    expect(text).toContain('Paused')
  })
})
