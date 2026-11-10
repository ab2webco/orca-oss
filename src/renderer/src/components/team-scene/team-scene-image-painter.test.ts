// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { figureSeedOf } from './team-scene-figure-looks'
import { createImagePainter, type TeamSceneArtImage } from './team-scene-image-painter'
import type { TeamSceneFrame } from './team-scene-painter'
import { recordingContext, type RecordedCall } from './team-scene-recording-context'
import { CASTLE_BANNER } from './team-scene-castle-sites'
import { OFFICE_NOTE } from './team-scene-office-builds'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }

const role = (sheets: string[]): OrchestratorGameSceneNativeStyle['roles']['lead'] => ({
  sheets,
  frame: { width: 128, height: 128 },
  feet: { x: 64, y: 122 },
  size: 76,
  animations: {
    idle: { row: 0, frames: 4, fps: 4 },
    work: { row: 1, frames: 6, fps: 8 },
    walk: { row: 2, frames: 8, fps: 8, stride: 35 }
  }
})

const style = (
  extra: Partial<OrchestratorGameSceneNativeStyle> = {}
): OrchestratorGameSceneNativeStyle =>
  ({
    layers: [{ src: 'sky.png' }, { src: 'grass.png', front: true }],
    roles: { lead: role(['lead.png']), member: role(['m1.png', 'm2.png']) },
    props: { station: 'desk.png' },
    ...extra
  }) satisfies OrchestratorGameSceneNativeStyle

const image = (width: number, height: number): TeamSceneArtImage =>
  ({ width, height }) as TeamSceneArtImage

const IMAGES = new Map<string, TeamSceneArtImage>([
  ['sky.png', image(1536, 352)],
  ['grass.png', image(1536, 352)],
  ['desk.png', image(240, 128)],
  ['lead.png', image(1024, 896)],
  ['advisor.png', image(1024, 896)],
  ['m1.png', image(1024, 896)],
  ['m2.png', image(1024, 896)]
])

const actor = (key: string, extra: Partial<TeamSceneActor> = {}): TeamSceneActor => ({
  key,
  role: key === 'lead' ? 'lead' : key === 'advisor' ? 'advisor' : 'member',
  name: key,
  characterKey: null,
  x: 0.5,
  depth: 1,
  facing: 1,
  pose: 'idle',
  gait: 0,
  stride: 8.8 * teamSceneScaleAt(1),
  carrying: false,
  emote: null,
  jump: 0,
  ...extra
})

const frame = (extra: Partial<TeamSceneFrame> = {}): TeamSceneFrame => ({
  width: 400,
  height: 176,
  ratio: 2,
  t: 0,
  dt: 1 / 30,
  actors: [actor('lead')],
  effects: [],
  overflow: 0,
  stations: [],
  sites: [],
  trophies: [],
  ...extra
})

const sprites = (calls: RecordedCall[]): RecordedCall[] =>
  calls.filter((c) => c.name === 'drawImage' && c.args.length === 9)

const painterOf = (art = style()) =>
  createImagePainter({ art: { style: art, images: IMAGES }, colors: COLORS, builds: null })

let backdropCalls: RecordedCall[][] = []
beforeEach(() => {
  backdropCalls = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const recorder = recordingContext()
    backdropCalls.push(recorder.calls)
    return recorder.g
  })
})
afterEach(() => vi.restoreAllMocks())

describe('createImagePainter', () => {
  it('draws each frame at the declared size with the feet on the stage', () => {
    const { g, calls } = recordingContext()
    painterOf().paint(g, frame())
    const [sprite] = sprites(calls)
    const [source, sx, sy, sw, sh, dx, dy, dw, dh] = sprite!.args
    expect(source).toBe(IMAGES.get('lead.png'))
    // t is 0 and x is 0.5, so this figure's own phase picks the column.
    expect([sx, sy, sw, sh]).toEqual([(14 % 4) * 128, 0, 128, 128])
    expect(dw).toBeCloseTo(76)
    expect(dh).toBeCloseTo(76)
    // translate puts the origin on the feet, so the frame sits above and around it.
    expect(dx).toBeCloseTo(-38)
    expect(dy).toBeCloseTo((-122 / 128) * 76)
    const origin = calls.find((c) => c.name === 'translate')
    expect(origin?.args).toEqual([200, 176 - 36 + 22])
  })

  it('shrinks with depth by the same scale the engine uses', () => {
    const { g, calls } = recordingContext()
    painterOf().paint(g, frame({ actors: [actor('lead', { depth: 0 })] }))
    expect(sprites(calls)[0]!.args[8]).toBeCloseTo(76 * (teamSceneScaleAt(0) / teamSceneScaleAt(1)))
  })

  it('picks the pose row and steps frames by fps', () => {
    const { g, calls } = recordingContext()
    const stations = [{ x: 0, depth: 1 }]
    painterOf().paint(g, frame({ t: 1, stations, actors: [actor('m', { pose: 'work', x: 0 })] }))
    const [, sx, sy] = sprites(calls)[0]!.args
    expect(sy).toBe(128)
    expect(sx).toBe((8 % 6) * 128)
  })

  it('never sits a figure with no station on the air: work is the seated row', () => {
    const { g, calls } = recordingContext()
    painterOf().paint(g, frame({ actors: [actor('lead', { pose: 'work', x: 0 })] }))
    expect(sprites(calls)[0]!.args[2]).toBe(0)
  })

  // ORCA-1139: with no station, a working lead hands out its scroll as V28's lead does.
  const acting = () => {
    const full = role(['lead.png'])
    full.animations.give = { row: 4, frames: 4, fps: 6 }
    full.animations.cheer = { row: 6, frames: 6, fps: 10 }
    return painterOf(style({ roles: { lead: full, member: full } }))
  }
  const cellsOver = (pose: TeamSceneActor['pose']): Set<string> => {
    const painter = acting()
    return new Set(
      Array.from({ length: 12 }, (_, i) => {
        const { g, calls } = recordingContext()
        painter.paint(g, frame({ t: i / 6, actors: [actor('lead', { pose, x: 0 })] }))
        const [, sx, sy] = sprites(calls)[0]!.args
        return `${String(sx)},${String(sy)}`
      })
    )
  }

  it('animates a working lead with no station on its give row', () => {
    const cells = cellsOver('work')
    expect([...cells].every((cell) => cell.endsWith(',512'))).toBe(true)
    expect(cells.size).toBeGreaterThan(1)
  })

  it('holds a done figure still on the last cheer frame', () => {
    expect([...cellsOver('done')]).toEqual([`${5 * 128},768`])
  })

  it('keeps an idle figure apart from a done one', () => {
    expect([...cellsOver('idle')].every((cell) => cell.endsWith(',0'))).toBe(true)
  })

  it('stands an action the art does not have on idle', () => {
    const { g, calls } = recordingContext()
    painterOf().paint(g, frame({ actors: [actor('lead', { pose: 'cheer', x: 0 })] }))
    expect(sprites(calls)[0]!.args[2]).toBe(0)
  })

  it('steps walk by distance, so one cycle covers the sheet stride on the ground', () => {
    const paintAfter = (px: number): number => {
      const { g, calls } = recordingContext()
      const walked = actor('lead', { pose: 'walk' })
      const gait = (px / walked.stride) * Math.PI
      painterOf().paint(g, frame({ actors: [{ ...walked, gait }] }))
      return sprites(calls)[0]!.args[1] as number
    }
    const cyclePx = 35 * (76 / 128)
    expect(paintAfter(0)).toBe(0)
    expect(paintAfter(cyclePx / 2 + 0.01)).toBe(4 * 128)
    expect(paintAfter(cyclePx + 0.01)).toBe(0)
  })

  it('keeps a member on its sheet by its character, not its pane', () => {
    const sheetOf = (key: string, characterKey: string | null): unknown => {
      const { g, calls } = recordingContext()
      painterOf().paint(g, frame({ actors: [actor(key, { characterKey })] }))
      return sprites(calls)[0]!.args[0]
    }
    expect(sheetOf('pane-1', 'hero')).toBe(sheetOf('pane-2', 'hero'))
    const looks = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((key) => sheetOf(key, key)))
    expect(looks).toEqual(new Set([IMAGES.get('m1.png'), IMAGES.get('m2.png')]))
  })

  it('dresses the advisor in the member art when it has none, and in its own otherwise', () => {
    const sheetOf = (art: OrchestratorGameSceneNativeStyle): unknown => {
      const { g, calls } = recordingContext()
      painterOf(art).paint(g, frame({ actors: [actor('advisor')] }))
      return sprites(calls)[0]!.args[0]
    }
    expect([IMAGES.get('m1.png'), IMAGES.get('m2.png')]).toContain(sheetOf(style()))
    const own = style({
      roles: { ...style().roles, advisor: role(['advisor.png']) }
    })
    expect(sheetOf(own)).toBe(IMAGES.get('advisor.png'))
  })

  it('mirrors a figure that faces left', () => {
    const { g, calls } = recordingContext()
    painterOf().paint(g, frame({ actors: [actor('lead', { facing: -1 })] }))
    expect(calls.find((c) => c.name === 'scale')?.args).toEqual([-1, 1])
  })

  it('faces a seated member its station, as the prop is drawn', () => {
    const { g, calls } = recordingContext()
    const stations = [{ x: 0.5, depth: 1 }]
    const seated = actor('m', { facing: -1, pose: 'work' })
    painterOf().paint(g, frame({ actors: [seated], stations }))
    expect(calls.find((c) => c.name === 'scale')?.args).toEqual([1, 1])
  })

  it('draws the station centered on its seat, in the art scale, behind the figures', () => {
    const { g, calls } = recordingContext()
    const stations = [{ x: 0.25, depth: 1 }]
    painterOf().paint(g, frame({ actors: [actor('lead')], stations }))
    const desk = calls.findIndex(
      (c) => c.name === 'drawImage' && c.args[0] === IMAGES.get('desk.png')
    )
    const args = calls[desk]!.args
    const px = 76 / 128
    expect(args[1]).toBeCloseTo(100 - (240 * px) / 2)
    expect(args[3]).toBeCloseTo(240 * px)
    expect(args[4]).toBeCloseTo(128 * px)
    expect(args[2]).toBeCloseTo(162 - 128 * px)
    expect(desk).toBeLessThan(calls.indexOf(sprites(calls)[0]!))
  })

  it('bakes each stage once, and draws the front one over the figures', () => {
    const painter = painterOf()
    const { g, calls } = recordingContext()
    painter.paint(g, frame())
    painter.paint(g, frame())
    expect(backdropCalls).toHaveLength(2)
    const back = backdropCalls[0]!.filter((c) => c.name === 'drawImage')
    const front = backdropCalls[1]!.filter((c) => c.name === 'drawImage')
    expect(back.map((c) => c.args[0])).toEqual([IMAGES.get('sky.png')])
    expect(front.map((c) => c.args[0])).toEqual([IMAGES.get('grass.png')])
    const lastSprite = calls.lastIndexOf(sprites(calls).at(-1)!)
    expect(calls.slice(lastSprite).some((c) => c.name === 'drawImage' && c.args.length === 5)).toBe(
      true
    )
  })

  // ORCA-1139: Quest's clouds were baked into the sky, so they never moved.
  it('scrolls a drifting layer with the clock, between still layers baked once', () => {
    IMAGES.set('clouds.png', image(1536, 352))
    const painter = painterOf(
      style({
        layers: [
          { src: 'sky.png' },
          { src: 'clouds.png', drift: 6 },
          { src: 'grass.png', front: true }
        ]
      })
    )
    const cloudsAt = (t: number): number[] => {
      const { g, calls } = recordingContext()
      painter.paint(g, frame({ t, actors: [] }))
      return calls
        .filter((c) => c.name === 'drawImage' && c.args[0] === IMAGES.get('clouds.png'))
        .map((c) => Number(c.args[1]))
    }
    const still = cloudsAt(0)
    const later = cloudsAt(10)
    expect(still.length).toBeGreaterThan(0)
    // 6 px a second over 10 s, wrapped around the drawn width.
    expect(later[0]! - still[0]!).toBeCloseTo(60)
    expect(backdropCalls).toHaveLength(2)
    expect(backdropCalls[0]!.filter((c) => c.name === 'drawImage').map((c) => c.args[0])).toEqual([
      IMAGES.get('sky.png')
    ])
  })

  it('covers a narrow stage from the bottom center and a wide one from the bottom', () => {
    const coverAt = (width: number): unknown[] => {
      backdropCalls = []
      const { g } = recordingContext()
      painterOf().paint(g, frame({ width, actors: [] }))
      return backdropCalls[0]!.find((c) => c.name === 'drawImage')!.args
    }
    expect(coverAt(320).slice(1)).toEqual([-224, 0, 768, 176])
    const wide = coverAt(1000)
    expect(wide[1]).toBeCloseTo(0)
    expect(wide[3]).toBeCloseTo(1000)
    expect(wide[2]).toBeCloseTo(176 - 1000 * (352 / 1536))
  })

  it('shows who needs the user: a status shadow and the emote above the head', () => {
    const { g, fills } = recordingContext()
    painterOf().paint(g, frame({ actors: [actor('lead', { emote: 'alert' })] }))
    expect(fills().filter((fill) => fill === COLORS.attention).length).toBeGreaterThanOrEqual(2)
  })

  it('counts members past the seats', () => {
    const { g, calls } = recordingContext()
    painterOf().paint(g, frame({ overflow: 3 }))
    expect(calls.find((c) => c.name === 'fillText')?.args[0]).toBe('+3')
  })

  it('lifts a bubble to the top of the frame at that depth', () => {
    const painter = painterOf()
    expect(painter.height).toBe(176)
    expect(painter.headTop(1, 176)).toBeCloseTo(162 - (122 / 128) * 76)
    expect(painter.headTop(0, 176)).toBeGreaterThan(painter.headTop(1, 176) - 22 + 1)
  })

  it('still paints after dispose, as StrictMode disposes a painter it keeps', () => {
    const painter = painterOf()
    const { g, calls } = recordingContext()
    painter.dispose()
    painter.paint(g, frame())
    expect(sprites(calls)).toHaveLength(1)
  })
})

describe('createImagePainter portrait', () => {
  it("draws a card face from the character's idle frame, head up, covering the face", () => {
    const painter = createImagePainter({
      art: { style: style(), images: IMAGES },
      colors: COLORS,
      builds: null
    })
    const face = (who: Pick<TeamSceneActor, 'role' | 'key' | 'characterKey' | 'name'>) => {
      const { g, calls } = recordingContext()
      painter.portrait!(g, who, 38)
      const [call] = sprites(calls)
      return call!.args as [
        TeamSceneArtImage,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number
      ]
    }
    const merlin = face({ role: 'member', key: 'p1', characterKey: 'merlin', name: 'Merlín' })
    expect(face({ role: 'member', key: 'p2', characterKey: 'merlin', name: 'Merlín' })[0]).toBe(
      merlin[0]
    )
    const sheet = ['m1.png', 'm2.png'][figureSeedOf('merlin') % 2]!
    expect(merlin[0]).toBe(IMAGES.get(sheet))
    // The idle row's first frame, cut above the feet so the head fills the face.
    const [, sx, sy, sw, sh] = merlin
    expect(sx).toBeGreaterThanOrEqual(0)
    expect(sx + sw).toBeLessThanOrEqual(128)
    expect(sy).toBeGreaterThanOrEqual(0)
    expect(sy + sh).toBeLessThan(122)
    expect(sw).toBe(sh)
    expect(merlin[7]).toBeGreaterThanOrEqual(38)
    expect(face({ role: 'lead', key: 'lead', characterKey: null, name: 'Alfred' })[0]).toBe(
      IMAGES.get('lead.png')
    )
  })
})

// ORCA-1139: V28's office lights each desk's screen by what its worker does.
describe('createImagePainter station screens', () => {
  const screen = { x: 170, y: 20, width: 60, height: 40 }
  const screenFills = (pose: TeamSceneActor['pose'] | null, t = 0): unknown[] => {
    const painter = painterOf(style({ props: { station: 'desk.png', stationScreen: screen } }))
    const { g, calls } = recordingContext()
    const spot = { x: 0.5, depth: 1 }
    const actors = pose ? [actor('m', { pose, x: spot.x, depth: spot.depth })] : []
    painter.paint(g, frame({ t, actors, stations: [spot] }))
    return calls.filter((c) => c.name === 'fillRect').map((c) => c.fillStyle)
  }

  it('draws code while the worker works, amber when it asks, green when done, off when empty', () => {
    expect(screenFills('work')[0]).toBe('#0f1826')
    expect(screenFills('raise')[0]).toBe('#3a2d10')
    expect(screenFills('done')[0]).toBe('#10352a')
    expect(screenFills(null)).toEqual(['#0a0c10'])
    expect(screenFills('done')).toContain('#4ade80')
  })

  it('scrolls the code lines while the worker works', () => {
    const painter = painterOf(style({ props: { station: 'desk.png', stationScreen: screen } }))
    const at = (t: number) => {
      const { g, calls } = recordingContext()
      const spot = { x: 0.5, depth: 1 }
      painter.paint(g, frame({ t, actors: [actor('m', { pose: 'work' })], stations: [spot] }))
      return JSON.stringify(calls.filter((c) => c.name === 'fillRect').map((c) => c.args))
    }
    expect(at(0)).not.toBe(at(0.4))
  })
})

describe('createImagePainter builds', () => {
  const site = { key: 'm', spot: { x: 0.155, depth: 0.5 }, stage: 4 as const, broken: false }
  const bannerIn = (builds: 'castle' | null, extra: Partial<TeamSceneFrame>) => {
    const painter = createImagePainter({
      art: { style: style(), images: IMAGES },
      colors: COLORS,
      builds
    })
    const { g, fills } = recordingContext()
    painter.paint(g, frame(extra))
    return fills().filter((f) => f === CASTLE_BANNER).length
  }

  it('raises a castle build at each seat in the Figures art', () => {
    expect(bannerIn('castle', { sites: [site] })).toBe(1)
    expect(bannerIn(null, { sites: [site] })).toBe(0)
  })

  it('keeps a finished tower for each trophy in the Figures art', () => {
    expect(
      bannerIn('castle', {
        trophies: [
          { key: 'a', name: 'a' },
          { key: 'b', name: 'b' }
        ]
      })
    ).toBe(2)
  })
})

describe('createImagePainter office builds', () => {
  const screen = { x: 170, y: 20, width: 60, height: 40 }
  const spot = { x: 0.5, depth: 1 }
  const site = (broken: boolean) => ({
    key: 'm',
    spot: { x: spot.x + 0.055, depth: spot.depth },
    stage: 3 as const,
    broken
  })
  const paint = (broken: boolean) => {
    const painter = createImagePainter({
      art: {
        style: style({ props: { station: 'desk.png', stationScreen: screen } }),
        images: IMAGES
      },
      colors: COLORS,
      builds: 'office'
    })
    const { g, calls } = recordingContext()
    const actors = [actor('m', { pose: 'work', x: spot.x, depth: spot.depth })]
    painter.paint(g, frame({ actors, stations: [spot], sites: [site(broken)] }))
    return calls.filter((c) => c.name === 'fillRect').map((c) => c.fillStyle)
  }

  it('pins a task board above each desk in the Office art', () => {
    expect(paint(false)).toContain(OFFICE_NOTE)
  })

  it("turns the desk's screen to the failure while its CI is red", () => {
    expect(paint(false)).toContain('#0f1826')
    expect(paint(true)).not.toContain('#0f1826')
    expect(paint(true)).toContain(COLORS.attention)
  })
})
