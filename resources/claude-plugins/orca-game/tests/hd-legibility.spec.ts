import { describe, expect, it } from 'vitest'

import { STATE_RING } from '../hooks/hd-party'
import { daylightAt } from '../hooks/hd-daylight'
import { lightnessOf, luminanceOf } from '../hooks/hd-lightness'
import { costumeSpriteOf, frameSpriteOf, hdSpritePixel, type HdSprite } from '../hooks/hd-sprite'
import { UPPER_HALF } from '../hooks/pixel-canvas'
import { hdSceneGridOf } from '../hooks/scene-hd'
import { hdFarPixel, hdFrameOf, hdMidPixel, hdSkyBaseOf } from '../hooks/scene-hd-land'
import { SCENES, type SceneDefinition, type ScenePhase } from '../hooks/scenes/index'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../../../src/shared/orchestrator-game-scene-authoring'
import { parseOrchestratorGameScene } from '../../../../src/shared/orchestrator-game-scene'

// A dark ink line reads as an outline; anything lighter than this reads as a glow.
const INK_CEILING = 0.03
const BRIGHT = ['#4fc3f7', '#ffe08a', '#ffffff', '#9fe0ff', '#ff8ad8']

const brightSceneFile = (): SceneDefinition => {
  const file = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE) as {
    costumes: Record<string, { colors: Record<string, string> }>
  }
  for (const costume of Object.values(file.costumes)) {
    costume.colors = Object.fromEntries(
      Object.keys(costume.colors).map((key, i) => [key, BRIGHT[i % BRIGHT.length] ?? '#ffffff'])
    )
  }
  const parsed = parseOrchestratorGameScene(JSON.stringify(file), 'file:.orca/scenes/bright.json')
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.definition
}

const SCENES_UNDER_TEST = [...Object.values(SCENES), brightSceneFile()]

const darkestOf = (colors: Readonly<Record<string, number>>): number =>
  Math.min(...Object.values(colors).map(luminanceOf))

const edgeOf = (sprite: HdSprite): [number, number] => {
  const r = sprite.rows.findIndex((row) => row.includes('#'))
  return [sprite.rows[r]?.indexOf('#') ?? 0, r]
}

const figuresOf = (scene: SceneDefinition): HdSprite[] => [
  ...Object.values(scene.costumes).flatMap((costume) => [
    costumeSpriteOf(costume, 0, false),
    costumeSpriteOf(costume, 0, true)
  ]),
  ...(scene.foe === undefined ? [] : [costumeSpriteOf(scene.foe, 0, false)]),
  ...(scene.cast?.pet?.frames ?? []).map((frame) =>
    frameSpriteOf(frame, scene.cast?.pet?.colors ?? {})
  ),
  ...(scene.cast?.advisor?.frames ?? []).map((frame) =>
    frameSpriteOf(frame, scene.cast?.advisor?.colors ?? {})
  )
]

describe('hd outlines', () => {
  it('ink every figure darker than its darkest fill and below a fixed ceiling, state rings too', () => {
    for (const scene of SCENES_UNDER_TEST) {
      for (const sprite of figuresOf(scene)) {
        const limit = Math.min(INK_CEILING, darkestOf(sprite.colors))
        const [x, y] = edgeOf(sprite)
        const inks = [
          hdSpritePixel(sprite, x, y, 0, 0) ?? 0xffffff,
          ...Object.values(STATE_RING).map(
            (ring) => hdSpritePixel(sprite, x, y, 0, 0, ring) ?? 0xffffff
          )
        ]
        for (const ink of inks) {
          expect([scene.id, ink.toString(16), luminanceOf(ink) < limit]).toEqual([
            scene.id,
            ink.toString(16),
            true
          ])
        }
      }
    }
  })

  it('never rings Vigilante’s party in the bright state colour the owner saw as a halo', () => {
    const grid = hdSceneGridOf({
      scene: SCENES.vigilante as SceneDefinition,
      phase: 'build',
      columns: 120,
      rows: 9,
      tick: 41,
      caption: '',
      since: 0,
      party: [
        { key: 'a', phase: 'verify', state: 'working' },
        { key: 'b', phase: 'docs', state: 'working' }
      ]
    })
    expect(
      grid.some((cell) => cell[1] === STATE_RING.working || cell[2] === STATE_RING.working)
    ).toBe(false)
  })
})

const STAR = 0xf5f3c8
const SKY_ROWS = 2

const skyAt = (scene: SceneDefinition, phase: ScenePhase, hour: number): number[] =>
  hdSceneGridOf({
    scene,
    phase: phase === 'working' ? undefined : phase,
    columns: 120,
    rows: 9,
    tick: 41,
    caption: '',
    since: 0,
    light: daylightAt(hour)
  })
    .slice(0, SKY_ROWS * 120)
    .flatMap((cell) => (cell[0] === UPPER_HALF ? [cell[1] ?? 0, cell[2] ?? 0] : []))

const meanLightnessOf = (colors: readonly number[]): number =>
  colors.reduce((sum, color) => sum + lightnessOf(color), 0) / Math.max(1, colors.length)

describe('hd day and night', () => {
  it('lights every built-in scene’s sky clearly at noon and darkens it with stars at midnight', () => {
    for (const scene of Object.values(SCENES)) {
      for (const phase of Object.keys(scene.looks) as ScenePhase[]) {
        const noon = skyAt(scene, phase, 12)
        const midnight = skyAt(scene, phase, 0)
        const gap = meanLightnessOf(noon) - meanLightnessOf(midnight)
        expect([scene.id, phase, gap > 20]).toEqual([scene.id, phase, true])
        expect([scene.id, phase, noon.includes(STAR), midnight.includes(STAR)]).toEqual([
          scene.id,
          phase,
          false,
          true
        ])
      }
    }
  })
})

// Lightness (CIE L*) a far or mid layer keeps from the sky behind it, so it reads at night too.
const LAYER_FLOOR = 8
const WIDTH = 130

describe('hd scenery against the sky', () => {
  it('keeps the far and mid layers legibly apart from the sky in every scene, phase and light', () => {
    for (const scene of SCENES_UNDER_TEST) {
      for (const phase of Object.keys(scene.looks) as ScenePhase[]) {
        for (const hour of [12, 18, 0]) {
          const frame = hdFrameOf({
            look: scene.looks[phase],
            width: WIDTH,
            rows: 9,
            tick: 41,
            scroll: 41,
            light: daylightAt(hour)
          })
          let closest = { far: 100, mid: 100 }
          // Why short of the sun: its glow is not the sky a layer stands against.
          for (let x = 0; x < WIDTH - 40; x += 1) {
            for (let y = 0; y < frame.ground; y += 1) {
              // Why: nor is a searchlight's beam, which slants down from the signal like a sun ray.
              const isBeam =
                frame.look.isSignal === true &&
                y > frame.sunY &&
                Math.abs(x - (frame.sunX - (y - frame.sunY) * 1.4)) <= 2
              if (isBeam) {
                continue
              }
              const sky = lightnessOf(hdSkyBaseOf(frame, x, y))
              const far = hdFarPixel(frame, x, y)
              const mid = hdMidPixel(frame, x, y)
              closest = {
                far:
                  far === undefined
                    ? closest.far
                    : Math.min(closest.far, Math.abs(lightnessOf(far) - sky)),
                mid:
                  mid === undefined
                    ? closest.mid
                    : Math.min(closest.mid, Math.abs(lightnessOf(mid) - sky))
              }
            }
          }
          expect([
            scene.id,
            phase,
            hour,
            closest.far >= LAYER_FLOOR,
            closest.mid >= LAYER_FLOOR
          ]).toEqual([scene.id, phase, hour, true, true])
        }
      }
    }
  })
})

// A hero body stands in front of the far and near layers; below this L* gap it sinks into them.
const HERO_APART = 15

describe('hero against the skyline', () => {
  it('keeps every vigilante body colour but its ink clear of the far and near layers in every phase', () => {
    const scene = SCENES.vigilante as SceneDefinition
    for (const phase of Object.keys(scene.looks) as ScenePhase[]) {
      const colors = Object.values(scene.costumes[phase].colors)
      const ink = Math.min(...colors.map(luminanceOf))
      const body = colors.filter((color) => luminanceOf(color) > ink)
      const { far, near } = scene.looks[phase]
      for (const color of body) {
        for (const layer of [far, near]) {
          const apart = Math.abs(lightnessOf(color) - lightnessOf(layer)) >= HERO_APART
          expect([phase, color.toString(16), apart]).toEqual([phase, color.toString(16), true])
        }
      }
    }
  })
})
