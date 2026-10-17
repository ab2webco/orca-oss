import { describe, expect, it } from 'vitest'

import { forgetFrames, isNewFrame, rememberFrame } from '../hooks/frame-gate'
import { base64Of, cellsOf, UPPER_HALF } from '../hooks/pixel-canvas'
import { sceneGridOf } from '../hooks/scene'
import { hdSceneGridOf } from '../hooks/scene-hd'
import { sceneOf } from '../hooks/scenes/index'

const QUEST = sceneOf('quest')
const plainCellsOf = (grid: readonly (readonly number[])[]): string =>
  base64Of(new Uint8Array(new Uint32Array(grid.flat()).buffer))

describe('packing cells', () => {
  it('packs exactly what the plain encoder packs, whatever sizes come and go', () => {
    const grids = [
      sceneGridOf(QUEST, 'build', 120, 41, 'Editing scene.ts', 0),
      hdSceneGridOf({
        scene: QUEST,
        phase: 'build',
        columns: 120,
        rows: 9,
        tick: 41,
        caption: 'x',
        since: 0
      }),
      sceneGridOf(QUEST, 'build', 7, 3, '', 0),
      [[UPPER_HALF, 0xffffff, 0x000000]],
      sceneGridOf(QUEST, 'build', 120, 42, 'Editing scene.ts', 0)
    ]
    for (const grid of grids) {
      expect(cellsOf(grid)).toBe(plainCellsOf(grid))
    }
  })
})

describe('the frame gate', () => {
  it('lets a frame through once and holds the same frame back until it changes', () => {
    forgetFrames()
    expect(isNewFrame('r1', 'scene', 'AAAA')).toBe(true)
    expect(isNewFrame('r1', 'scene', 'AAAA')).toBe(false)
    expect(isNewFrame('r2', 'scene', 'AAAA')).toBe(true)
    expect(isNewFrame('r1', 'scene', 'BBBB')).toBe(true)
    expect(isNewFrame('r1', 'scene', 'AAAA')).toBe(true)
  })

  it('counts what a render drew as already sent, and forgets a request that is gone', () => {
    forgetFrames()
    rememberFrame('r1', 'scene', 'CCCC')
    expect(isNewFrame('r1', 'scene', 'CCCC')).toBe(false)
    forgetFrames('r1')
    expect(isNewFrame('r1', 'scene', 'CCCC')).toBe(true)
  })
})
