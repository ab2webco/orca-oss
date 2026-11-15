// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOON } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import type {
  SceneDefinition,
  SceneProp
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition'
import { parseOrchestratorGameScene } from '../../../../shared/orchestrator-game-scene'
import template from '../../../../shared/orchestrator-game-scene-template.json'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { createPixelPainter } from './team-scene-pixel-painter'
import { drawPixelProp } from './team-scene-pixel-prop'
import { recordingContext } from './team-scene-recording-context'

const SWORD = '#e8eef4'
const PAPER = '#f4e6c0'
const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }
// Two columns told apart by color, so a mirrored prop shows which side is its handle.
const MALLET: SceneProp = { rows: ['AB', 'AB'], colors: { A: 0xaa0001, B: 0x0000bb } }

const actor = (extra: Partial<TeamSceneActor> = {}): TeamSceneActor => ({
  key: 'a',
  role: 'member',
  name: 'Ada',
  characterKey: null,
  x: 0.2,
  depth: 0.5,
  facing: 1,
  pose: 'work',
  gait: 0,
  stride: 6,
  carrying: false,
  emote: null,
  jump: 0,
  ...extra
})

// Hand at cx + 4 * facing: x 24 facing right, 16 facing left.
const fillsOf = (prop: SceneProp | undefined, extra: Partial<TeamSceneActor> = {}, t = 0) => {
  const r = recordingContext()
  drawPixelProp({ g: r.g, a: actor(extra), t, cx: 20, hy: 10, pixel: 1, prop })
  return r.calls
    .filter((c) => c.name === 'fillRect')
    .map((c) => ({ color: c.fillStyle, x: c.args[0] as number, y: c.args[1] as number }))
}

describe('drawPixelProp', () => {
  it("draws Quest's sword in V28's tool tone", () => {
    expect(fillsOf('sword').map((one) => one.color)).toEqual([SWORD])
  })

  it('draws nothing for a scene without a prop, in every pose', () => {
    for (const pose of ['work', 'raise', 'wave', 'cheer', 'done', 'idle', 'walk'] as const) {
      expect(fillsOf(undefined, { pose })).toEqual([])
    }
  })

  it('still hands over a paper in a scene without a prop', () => {
    expect(fillsOf(undefined, { carrying: true }).map((one) => one.color)).toEqual([PAPER])
  })

  it("draws a scene's prop facing right from the hand, mirrored when facing left", () => {
    const right = fillsOf(MALLET)
    expect(right.filter((one) => one.color === '#aa0001').map((one) => one.x)).toEqual([25, 25])
    expect(right.filter((one) => one.color === '#0000bb').map((one) => one.x)).toEqual([26, 26])
    const left = fillsOf(MALLET, { facing: -1 })
    expect(left.filter((one) => one.color === '#aa0001').map((one) => one.x)).toEqual([15, 15])
    expect(left.filter((one) => one.color === '#0000bb').map((one) => one.x)).toEqual([14, 14])
  })

  it("swings a scene's prop up and down while working, and lifts it to ask", () => {
    const topAt = (extra: Partial<TeamSceneActor>, t: number): number =>
      Math.min(...fillsOf(MALLET, extra, t).map((one) => one.y))
    const swing = new Set(Array.from({ length: 24 }, (_, i) => topAt({}, i / 20)))
    expect(swing.size).toBeGreaterThan(1)
    expect(topAt({ pose: 'raise' }, 0)).toBeLessThan(topAt({}, 1))
  })
})

describe('the Pixel painter holds the scene prop', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recordingContext().g
    )
  })
  afterEach(() => vi.restoreAllMocks())

  const paintedColors = (scene: SceneDefinition): unknown[] => {
    const painter = createPixelPainter({ scene, light: NOON, colors: COLORS })
    const r = recordingContext()
    const actors = [actor(), actor({ key: 'lead', role: 'lead', name: 'Lead', x: 0.8 })]
    painter.paint(r.g, {
      width: 360,
      height: 126,
      ratio: 1,
      t: 1,
      dt: 1 / 30,
      actors,
      effects: [],
      overflow: 0,
      stations: [],
      sites: [],
      trophies: []
    })
    return r.calls.filter((c) => c.name === 'fillRect').map((c) => c.fillStyle)
  }
  const fileScene = (prop?: unknown): SceneDefinition => {
    const parsed = parseOrchestratorGameScene(JSON.stringify({ ...template, prop }), 'p/mario')
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    return parsed.definition as unknown as SceneDefinition
  }

  it("arms Quest's characters with its sword", () => {
    expect(paintedColors(QUEST_SCENE)).toContain(SWORD)
  })

  // ORCA-1202: a Mario scene file drew every character with Quest's sword.
  it('leaves the characters of a scene file without a prop empty-handed', () => {
    expect(paintedColors(fileScene())).not.toContain(SWORD)
  })

  it("draws a scene file's own prop in its own colors", () => {
    const colors = paintedColors(fileScene({ rows: ['H'], colors: { H: '#123456' } }))
    expect(colors).toContain('#123456')
    expect(colors).not.toContain(SWORD)
  })
})
