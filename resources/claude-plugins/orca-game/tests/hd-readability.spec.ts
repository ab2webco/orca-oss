import { describe, expect, it } from 'vitest'

import { hdBackdropPixel } from '../hooks/hd-backdrop'
import { daylightAt, landInLight } from '../hooks/hd-daylight'
import { particleCountOf } from '../hooks/hd-fx'
import { hdLandBakeOf } from '../hooks/hd-land-bake'
import { lightnessOf } from '../hooks/hd-lightness'
import { FIGURE_FLOOR, figureEdgeOf, GROUND_FLOOR } from '../hooks/hd-readability'
import { costumeSpriteOf, outlineOf } from '../hooks/hd-sprite'
import { hdHeroPoseOf, hdSceneGridOf } from '../hooks/scene-hd'
import { hdBakedLandOf } from '../hooks/hd-land-bake'
import { hdFarPixel, hdFrameOf, hdMidPixel, hdPondPixel, hdSkyPixel } from '../hooks/scene-hd-land'
import { SCENES, type SceneDefinition } from '../hooks/scenes/index'
import { sceneDefinitionOf } from '../hooks/scenes/scene-shape'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'

// The owner's readability rule holds for any scene: built-in, user-made or freshly templated.

const template = sceneDefinitionOf(JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE), 'file:new.json')
if (template === undefined) {
  throw new Error('template scene does not parse')
}
const ALL: readonly SceneDefinition[] = [...Object.values(SCENES), template]
const HOURS = [
  ['day', 12],
  ['night', 22]
] as const
const WIDTH = 120
const ROWS = 14

const chromaOf = (color: number): number => {
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

const framesOf = (scene: SceneDefinition, hour: number) =>
  Object.entries(scene.looks).map(([phase, look]) => {
    const frame = hdFrameOf({
      look,
      width: WIDTH,
      rows: ROWS,
      tick: 40,
      scroll: 40,
      light: daylightAt(hour)
    })
    const land = hdLandBakeOf(frame)
    const at = (x: number, y: number): number => hdBackdropPixel(frame, land, x, y)
    return { phase: phase as keyof SceneDefinition['costumes'], look, frame, land, at }
  })

describe('hd readability on every scene', () => {
  for (const scene of ALL) {
    for (const [label, hour] of HOURS) {
      it(`${scene.id} ${label}: few scattered single pixels behind the figures`, () => {
        for (const { frame, at } of framesOf(scene, hour)) {
          let lone = 0
          for (let y = 0; y < frame.pixels; y += 1) {
            for (let x = 0; x < WIDTH; x += 1) {
              const own = lightnessOf(at(x, y))
              const around = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)]
                .filter((_, i) =>
                  i === 0 ? y > 0 : i === 1 ? y < frame.pixels - 1 : i === 2 ? x > 0 : x < WIDTH - 1
                )
                .map(lightnessOf)
              lone += around.every((one) => Math.abs(one - own) >= 12) ? 1 : 0
            }
          }
          expect(lone / (WIDTH * frame.pixels)).toBeLessThanOrEqual(0.004)
        }
      })

      it(`${scene.id} ${label}: the walking strip reads as floor apart from the land behind it`, () => {
        for (const { frame, land, at } of framesOf(scene, hour)) {
          for (let x = 0; x < WIDTH; x += 1) {
            if (hdPondPixel(frame, x, frame.ground) !== undefined) {
              continue
            }
            const behind =
              hdBakedLandOf(land, frame, x, frame.ground - 1) ??
              hdSkyPixel(frame, x, frame.ground - 1)
            const gap = Math.abs(lightnessOf(at(x, frame.ground)) - lightnessOf(behind))
            expect(gap, `x=${x}`).toBeGreaterThanOrEqual(GROUND_FLOOR)
          }
        }
      })

      it(`${scene.id} ${label}: every figure's edge keeps the contrast floor against its background`, () => {
        for (const { phase, look, frame, at } of framesOf(scene, hour)) {
          const light = look.isNight
            ? daylightAt(12)
            : { ...frame.light, night: frame.light.night * 0.5 }
          const ink = landInLight(outlineOf(scene.costumes[phase].colors), light)
          for (let y = 0; y <= frame.ground; y += 1) {
            for (let x = 0; x < WIDTH; x += 1) {
              const behind = at(x, y)
              const edge = figureEdgeOf(ink, behind, look)
              expect(Math.abs(lightnessOf(edge) - lightnessOf(behind))).toBeGreaterThanOrEqual(
                FIGURE_FLOOR
              )
            }
          }
        }
      })

      it(`${scene.id} ${label}: the far range and hills sit back, muted next to the figures`, () => {
        let sum = 0
        let count = 0
        for (const { frame } of framesOf(scene, hour)) {
          for (let y = 0; y < frame.ground; y += 1) {
            for (let x = 0; x < WIDTH; x += 1) {
              const layer = hdMidPixel(frame, x, y) ?? hdFarPixel(frame, x, y)
              if (layer !== undefined) {
                sum += chromaOf(layer)
                count += 1
              }
            }
          }
        }
        expect(sum / count).toBeLessThanOrEqual(label === 'night' ? 0.1 : 0.18)
      })
    }
  }

  it('keeps the hero outline whole at night and parts it from the dark with a rim outside', () => {
    for (const scene of ALL) {
      const look = scene.looks.working
      const light = daylightAt(22)
      const tick = 30
      const grid = hdSceneGridOf({
        scene: { ...scene, cast: undefined },
        phase: 'working',
        columns: WIDTH,
        rows: ROWS,
        tick,
        caption: '',
        since: 0,
        light
      })
      const frame = hdFrameOf({ look, width: WIDTH, rows: ROWS, tick, scroll: tick, light })
      const land = hdLandBakeOf(frame)
      const ink = landInLight(
        outlineOf(scene.costumes.working.colors),
        look.isNight ? daylightAt(12) : { ...frame.light, night: frame.light.night * 0.5 }
      )
      const sprite = costumeSpriteOf(scene.costumes.working, hdHeroPoseOf(tick, false).frame, false)
      const inkedInArt = sprite.rows.join('').replace(/[^#:]/g, '').length
      const shownAt = (x: number, y: number) =>
        grid[Math.floor(y / 2) * WIDTH + x]?.[y % 2 === 0 ? 1 : 2]
      const isSunk = (color: number) => Math.abs(lightnessOf(ink) - lightnessOf(color)) < FIGURE_FLOOR
      let inked = 0
      let bare = 0
      for (let y = 0; y < frame.ground; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          if (shownAt(x, y) !== ink) {
            continue
          }
          inked += 1
          for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]] as const) {
            const behind = ny < 0 || nx < 0 || nx >= WIDTH ? undefined : hdBackdropPixel(frame, land, nx, ny)
            bare += behind !== undefined && shownAt(nx, ny) === behind && isSunk(behind) ? 1 : 0
          }
        }
      }
      expect(inked, scene.id).toBeGreaterThanOrEqual(inkedInArt)
      expect(bare, scene.id).toBe(0)
    }
  })

  it('keeps the drifting particles sparse', () => {
    expect(particleCountOf(200)).toBeLessThanOrEqual(10)
    expect(particleCountOf(80)).toBeLessThanOrEqual(4)
  })
})
