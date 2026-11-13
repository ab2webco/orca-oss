// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { createImagePainter, type TeamSceneArtImage } from './team-scene-image-painter'
import type { TeamSceneFrame } from './team-scene-painter'
import { recordingContext } from './team-scene-recording-context'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }
const ANVIL = '#46505c'

const role = (sheets: string[]): OrchestratorGameSceneNativeStyle['roles']['lead'] => ({
  sheets,
  frame: { width: 128, height: 128 },
  feet: { x: 64, y: 122 },
  size: 76,
  animations: { idle: { row: 0, frames: 4, fps: 4 } }
})

const STYLE = {
  layers: [{ src: 'sky.png' }],
  roles: { lead: role(['lead.png']), member: role(['m1.png']) },
  props: { station: 'desk.png' }
} satisfies OrchestratorGameSceneNativeStyle

const image = (width: number, height: number) => ({ width, height }) as TeamSceneArtImage
const IMAGES = new Map<string, TeamSceneArtImage>([
  ['sky.png', image(1536, 352)],
  ['desk.png', image(240, 128)],
  ['lead.png', image(1024, 896)],
  ['m1.png', image(1024, 896)]
])

const lead: TeamSceneActor = {
  key: 'lead',
  role: 'lead',
  name: 'lead',
  characterKey: null,
  x: 0.84,
  depth: 0.45,
  facing: -1,
  pose: 'idle',
  gait: 0,
  stride: 8,
  carrying: false,
  emote: null,
  jump: 0
}

const frame: TeamSceneFrame = {
  width: 349,
  height: 176,
  ratio: 2,
  t: 1,
  dt: 1 / 30,
  actors: [lead],
  effects: [],
  overflow: 0,
  stations: [],
  sites: [],
  trophies: []
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g)
})
afterEach(() => vi.restoreAllMocks())

// Why (ORCA-1150 C4): Figures is drawn by the image painter, so V30's props live there.
describe('createImagePainter props', () => {
  it("draws V30's props in Figures, behind the actors", () => {
    const painter = createImagePainter({
      art: { style: STYLE, images: IMAGES },
      colors: COLORS,
      builds: 'castle'
    })
    const { g, calls } = recordingContext()
    painter.paint(g, frame)
    const anvil = calls.findIndex((c) => c.name === 'fill' && c.fillStyle === ANVIL)
    const sprite = calls.findIndex((c) => c.name === 'drawImage' && c.args.length === 9)
    expect(anvil).toBeGreaterThan(-1)
    expect(anvil).toBeLessThan(sprite)
  })

  it('leaves the props out of the office', () => {
    const painter = createImagePainter({
      art: { style: STYLE, images: IMAGES },
      colors: COLORS,
      builds: 'office'
    })
    const { g, calls } = recordingContext()
    painter.paint(g, frame)
    expect(calls.some((c) => c.name === 'fill' && c.fillStyle === ANVIL)).toBe(false)
  })
})
