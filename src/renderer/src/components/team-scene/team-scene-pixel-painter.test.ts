// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { characterCostumeOf } from '../../../../../resources/claude-plugins/orca-game/hooks/character-look'
import { NOON } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { SCENES } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneFrame } from './team-scene-painter'
import { createPixelPainter } from './team-scene-pixel-painter'
import { recordingContext } from './team-scene-recording-context'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3' }

const actor = (key: string, extra: Partial<TeamSceneActor> = {}): TeamSceneActor => ({
  key,
  role: key === 'lead' ? 'lead' : 'member',
  name: key,
  characterKey: null,
  x: key === 'lead' ? 0.84 : 0.1,
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
const frame = (actors: TeamSceneActor[], width = 360): TeamSceneFrame => ({
  width,
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

let offscreen: ReturnType<typeof recordingContext>[] = []
beforeEach(() => {
  offscreen = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const r = recordingContext()
    offscreen.push(r)
    return r.g
  })
})
afterEach(() => vi.restoreAllMocks())

describe('createPixelPainter', () => {
  it('bakes the backdrop once per width and again after dispose', () => {
    const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
    const { g } = recordingContext()
    painter.paint(g, frame([]))
    painter.paint(g, frame([]))
    expect(offscreen).toHaveLength(1)
    painter.paint(g, frame([], 300))
    expect(offscreen).toHaveLength(2)
    painter.dispose()
    painter.paint(g, frame([], 300))
    expect(offscreen).toHaveLength(3)
  })

  // ORCA-1139: the game's clouds drift with its tick; a backdrop baked at tick 0 froze them.
  it('rebakes the sky as its clouds drift, and not on every frame', () => {
    const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
    const { g } = recordingContext()
    painter.paint(g, { ...frame([]), t: 0 })
    painter.paint(g, { ...frame([]), t: 0.3 })
    expect(offscreen).toHaveLength(1)
    painter.paint(g, { ...frame([]), t: 3 })
    expect(offscreen).toHaveLength(2)
  })

  it("draws each member in the scene's own figure for its name", () => {
    const colorsDrawnFor = (name: string): string => {
      offscreen = []
      const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
      painter.paint(recordingContext().g, frame([actor(name)]))
      // The last bitmap is the sprite; the first is the backdrop.
      return JSON.stringify(offscreen.at(-1)!.calls.map((c) => c.fillStyle))
    }
    const merlin = characterCostumeOf(QUEST_SCENE, 'Merlin', 'working')
    const gawain = characterCostumeOf(QUEST_SCENE, 'Gawain', 'working')
    expect(merlin).not.toEqual(gawain)
    expect(colorsDrawnFor('Merlin')).not.toBe(colorsDrawnFor('Gawain'))
    expect(colorsDrawnFor('Merlin')).toBe(colorsDrawnFor('Merlin'))
  })

  it.each(Object.values(SCENES))('draws the built-in $id scene with no edits', (scene) => {
    const painter = createPixelPainter({ scene, light: NOON, colors: COLORS })
    const r = recordingContext()
    painter.paint(
      r.g,
      frame([actor('lead'), actor('Merlin'), actor('advisor', { role: 'advisor' })])
    )
    expect(r.calls.filter((c) => c.name === 'drawImage')).toHaveLength(4)
    expect(offscreen.at(-1)!.calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(20)
  })

  it("asks for the game's thought cloud, not the glass bubble", () => {
    expect(createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS }).cloudPixel).toBe(
      3
    )
  })

  it('steps between the two leg frames while walking', () => {
    const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
    const spriteAt = (gait: number) => {
      const r = recordingContext()
      painter.paint(r.g, frame([actor('a', { pose: 'walk', gait })]))
      return r.calls.filter((c) => c.name === 'drawImage')[1]?.args[0]
    }
    expect(spriteAt(0)).not.toBe(spriteAt(Math.PI))
    expect(spriteAt(0)).toBe(spriteAt(0.2))
  })

  it('marks a member who needs the user in the attention colour', () => {
    const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
    const calm = recordingContext()
    painter.paint(calm.g, frame([actor('a')]))
    const asking = recordingContext()
    painter.paint(asking.g, frame([actor('a', { pose: 'raise', emote: 'alert' })]))
    expect(calm.calls.map((c) => c.fillStyle)).not.toContain(COLORS.attention)
    expect(asking.calls.map((c) => c.fillStyle)).toContain(COLORS.attention)
  })

  // ORCA-1097: the frame loop paints ~31 times a second, so a painter that ignores t draws one still.
  describe('idle motion as V28 draws it', () => {
    const fillsAt = (pose: TeamSceneActor['pose'], t: number): string => {
      const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
      const r = recordingContext()
      painter.paint(r.g, { ...frame([actor('a', { pose })]), t })
      return JSON.stringify(r.calls.filter((c) => c.name === 'fillRect'))
    }
    const over = (pose: TeamSceneActor['pose']): Set<string> =>
      new Set(Array.from({ length: 24 }, (_, i) => fillsAt(pose, i / 12)))

    it('swings a working member’s tool within each 2 s', () => {
      expect(over('work').size).toBeGreaterThan(1)
    })

    it('bobs the raised tool of a member who needs the user', () => {
      expect(over('raise').size).toBeGreaterThan(1)
    })

    it('keeps a resting member still', () => {
      expect(over('idle').size).toBe(1)
    })

    it('holds a done member’s tool on the shoulder, still', () => {
      expect(over('done').size).toBe(1)
    })

    it('draws working, resting, asking and done apart at the same moment', () => {
      const looks = new Set(
        (['work', 'idle', 'raise', 'done'] as const).map((pose) => fillsAt(pose, 0.1))
      )
      expect(looks.size).toBe(4)
    })
  })

  it('draws a card face from the same sprite, crowned for the lead, crisp and centered', () => {
    const painter = createPixelPainter({ scene: QUEST_SCENE, light: NOON, colors: COLORS })
    const face = (who: Pick<TeamSceneActor, 'role' | 'key' | 'characterKey' | 'name'>) => {
      const r = recordingContext()
      painter.portrait!(r.g, who, 38)
      expect(r.g.imageSmoothingEnabled).toBe(false)
      const drawn = r.calls.filter((c) => c.name === 'drawImage')
      expect(drawn).toHaveLength(1)
      return drawn[0]!.args as [HTMLCanvasElement, number, number, number, number]
    }
    const member = face({ role: 'member', key: 'p1', characterKey: 'merlin', name: 'Merlín' })
    const again = face({ role: 'member', key: 'p2', characterKey: 'merlin', name: 'Merlín' })
    const lead = face({ role: 'lead', key: 'lead', characterKey: null, name: 'Alfred' })
    expect(again[0]).toBe(member[0])
    expect(lead[0].height).toBeGreaterThan(member[0].height)
    // Why integer: every sprite pixel must land on whole device pixels.
    expect(Number.isInteger(member[3] / member[0].width)).toBe(true)
    expect(member[3]).toBeLessThanOrEqual(38)
  })
})
