import { describe, expect, it } from 'vitest'

import { daylightAt } from '../hooks/hd-daylight'
import { lightnessOf } from '../hooks/hd-lightness'
import { hdFarPixel, hdFrameOf, hdGroundPixel } from '../hooks/scene-hd-land'
import { SCENES, type ScenePhase } from '../hooks/scenes/index'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const WIDTH = 120
const ROWS = 10

// Why one row: texture is variety along x; colours that differ only by row were there before.
const rowTones = (pixel: (x: number, y: number) => number | undefined, y: number): number =>
  new Set(Array.from({ length: WIDTH }, (_, x) => pixel(x, y)).filter((c) => c !== undefined)).size

describe('hd land materials on every built-in scene', () => {
  for (const scene of Object.values(SCENES)) {
    for (const phase of PHASES) {
      const look = scene.looks[phase]
      it(`${scene.id} ${phase}: the far range and the ground are textured along a row`, () => {
        const frame = hdFrameOf({
          look,
          width: WIDTH,
          rows: ROWS,
          tick: 0,
          scroll: 0,
          light: daylightAt(12)
        })
        // A flat layer draws one tone on these rows; the calmer backdrop material keeps up to three.
        expect(
          rowTones((x, y) => hdFarPixel(frame, x, y), frame.ground - 2)
        ).toBeGreaterThanOrEqual(2)
        expect(
          rowTones((x, y) => hdGroundPixel(frame, x, y), frame.ground + 1)
        ).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('textures a custom scene from its own colors, which no built-in uses', () => {
    const json = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE) as {
      looks: Record<ScenePhase, Record<string, unknown>>
    }
    for (const phase of PHASES) {
      json.looks[phase] = {
        ...json.looks[phase],
        far: '#8a5a9e',
        near: '#3f7f8c',
        ground: '#9c6b3a'
      }
    }
    const look = sceneDefinitionOf(json, 'file:custom.json')?.looks.working
    if (look === undefined) {
      throw new Error('custom scene did not parse')
    }
    const frame = hdFrameOf({
      look,
      width: WIDTH,
      rows: ROWS,
      tick: 0,
      scroll: 0,
      light: daylightAt(12)
    })
    expect(rowTones((x, y) => hdFarPixel(frame, x, y), frame.ground - 2)).toBeGreaterThanOrEqual(2)
    expect(rowTones((x, y) => hdGroundPixel(frame, x, y), frame.ground + 1)).toBeGreaterThanOrEqual(
      3
    )
  })

  it('lights the far flank that faces the sun brighter than the one turned away', () => {
    const look = SCENES.quest?.looks.working
    if (look === undefined) {
      throw new Error('quest scene missing')
    }
    // Why right of the sun: there the lit flank rises to the right, which a fixed light gets wrong.
    const frame = hdFrameOf({
      look,
      width: WIDTH,
      rows: ROWS,
      tick: 0,
      scroll: 0,
      light: daylightAt(8)
    })
    const toward: number[] = []
    const away: number[] = []
    for (let x = Math.ceil(frame.sunX) + 2; x < WIDTH - 1; x += 1) {
      const left = frame.farTops[x] ?? 0
      const right = frame.farTops[x + 2] ?? 0
      const y = Math.ceil(frame.ground - (frame.farTops[x + 1] ?? 0)) + 1
      const color = hdFarPixel(frame, x, y)
      if (color === undefined || Math.abs(left - right) < 1) {
        continue
      }
      ;(Math.sign(frame.sunX - x) * (left - right) > 0 ? toward : away).push(lightnessOf(color))
    }
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
    expect(toward.length).toBeGreaterThan(5)
    expect(away.length).toBeGreaterThan(5)
    expect(mean(toward)).toBeGreaterThan(mean(away))
  })
})
