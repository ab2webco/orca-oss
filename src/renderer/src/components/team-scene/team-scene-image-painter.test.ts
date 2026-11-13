// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { figureSeedOf } from './team-scene-figure-looks'
import { createImagePainter, type TeamSceneArtImage } from './team-scene-image-painter'
import type { TeamSceneFrame } from './team-scene-painter'
import { recordingContext, type RecordedCall } from './team-scene-recording-context'
import { SCENE_DUST } from './team-scene-painter-marks'
import { CASTLE_BANNER } from './team-scene-castle-sites'
import { OFFICE_NOTE, OFFICE_TRAY } from './team-scene-office-builds'
import { OFFICE_COAT } from './team-scene-office-back'
import { OFFICE_VIRUS_COLORS } from './team-scene-office-virus'
import { STATION_SCREEN_GLOW, STATION_SCREEN_PASS } from './team-scene-station-screen'
import { seatPlanOf } from '../../../../shared/team-scene/team-scene-seats'

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

  it("holds up the advisor's gesture for a Jev decision above its head", () => {
    const rects = (gesture: TeamSceneActor['gesture']) => {
      const r = recordingContext()
      painterOf().paint(r.g, frame({ actors: [actor('advisor', { gesture })] }))
      return r.calls.filter((c) => c.name === 'fillRect').map((c) => c.fillStyle)
    }
    expect(rects('escalated')).toContain(COLORS.attention)
    expect(rects(null)).not.toContain(COLORS.attention)
  })

  it('draws whoever stands behind the row before the desks, so a monitor covers it', () => {
    const { g, calls } = recordingContext()
    const stations = [{ x: 0.3, depth: 0.55 }]
    const actors = [
      actor('advisor', { x: 0.3, depth: 0.15 }),
      actor('m', { x: 0.3, depth: 0.55, pose: 'work' })
    ]
    painterOf().paint(g, frame({ actors, stations }))
    const at = (image: TeamSceneArtImage | undefined) =>
      calls.findIndex((c) => c.name === 'drawImage' && c.args[0] === image)
    const desk = at(IMAGES.get('desk.png'))
    // The advisor wears the member art here; the first member sheet drawn is the advisor's.
    const figures = calls
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c }) =>
          c.name === 'drawImage' && c.args.length === 9 && c.args[0] !== IMAGES.get('desk.png')
      )
      .map(({ i }) => i)
    expect(figures[0]).toBeLessThan(desk)
    expect(figures[1]).toBeGreaterThan(desk)
  })

  it('draws the advisor in front of the desks while it holds up a gesture, though it stands behind', () => {
    const { g, calls } = recordingContext()
    const stations = [{ x: 0.3, depth: 0.55 }]
    const advisor = actor('advisor', { x: 0.24, depth: 0.15, gesture: 'escalated' })
    painterOf().paint(g, frame({ actors: [advisor], stations }))
    const desk = calls.findIndex(
      (c) => c.name === 'drawImage' && c.args[0] === IMAGES.get('desk.png')
    )
    const figure = calls.findIndex(
      (c) => c.name === 'drawImage' && c.args.length === 9 && c.args[0] !== IMAGES.get('desk.png')
    )
    expect(figure).toBeGreaterThan(desk)
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

  it('greets a member arriving at its Office desk by booting its screen, never a gold ring', () => {
    const greet = (builds: 'office' | 'castle') => {
      const painter = createImagePainter({
        art: {
          style: style({ props: { station: 'desk.png', stationScreen: screen } }),
          images: IMAGES
        },
        colors: COLORS,
        builds
      })
      const r = recordingContext()
      const actors = [actor('m', { pose: 'work', x: spot.x, depth: spot.depth })]
      const effects = [{ kind: 'burst' as const, key: 'm', reason: 'welcome' as const }]
      painter.paint(r.g, frame({ actors, effects, stations: [spot], sites: [site(false)] }))
      return r.calls.map((c) => c.fillStyle)
    }
    expect(greet('office')).not.toContain('#ffd24a')
    expect(greet('office')).toContain(STATION_SCREEN_GLOW)
    expect(greet('castle')).toContain('#ffd24a')
  })

  it('raises no dust on the Office floor for desk work, and keeps it for a castle build', () => {
    const dust = (builds: 'office' | 'castle', reason: 'build' | 'repair') => {
      const painter = createImagePainter({
        art: {
          style: style({ props: { station: 'desk.png', stationScreen: screen } }),
          images: IMAGES
        },
        colors: COLORS,
        builds
      })
      const r = recordingContext()
      const actors = [actor('m', { pose: 'work', x: spot.x, depth: spot.depth })]
      const effects = [{ kind: 'burst' as const, key: 'm', reason }]
      painter.paint(r.g, frame({ actors, effects, stations: [spot], sites: [site(false)] }))
      return r.calls.filter((c) => c.name === 'fillRect' && c.fillStyle === SCENE_DUST).length
    }
    expect(dust('office', 'build')).toBe(0)
    expect(dust('office', 'repair')).toBe(0)
    expect(dust('castle', 'build')).toBeGreaterThan(0)
  })

  it("flashes the member's Office screen green as its CI passes, and leaves a castle alone", () => {
    const flash = (builds: 'office' | 'castle') => {
      const painter = createImagePainter({
        art: {
          style: style({ props: { station: 'desk.png', stationScreen: screen } }),
          images: IMAGES
        },
        colors: COLORS,
        builds
      })
      const r = recordingContext()
      const actors = [actor('m', { pose: 'work', x: spot.x, depth: spot.depth })]
      const effects = [{ kind: 'ciGreen' as const, key: 'm' }]
      painter.paint(r.g, frame({ actors, effects, stations: [spot], sites: [site(false)] }))
      return r.calls.map((c) => c.fillStyle)
    }
    expect(flash('office')).toContain(STATION_SCREEN_PASS)
    expect(flash('castle')).not.toContain(STATION_SCREEN_PASS)
  })

  describe('the red-CI virus', () => {
    const painted = (broken: boolean, t: number, builds: 'office' | 'castle' = 'office') => {
      const painter = createImagePainter({
        art: {
          style: style({ props: { station: 'desk.png', stationScreen: screen } }),
          images: IMAGES
        },
        colors: COLORS,
        builds
      })
      const r = recordingContext()
      const actors = [actor('m', { pose: 'work', x: spot.x, depth: spot.depth })]
      painter.paint(r.g, frame({ t, actors, stations: [spot], sites: [site(broken)] }))
      return r
    }
    const deskX = (r: RecordedCall[]) =>
      r.find((c) => c.name === 'drawImage' && c.args[0] === IMAGES.get('desk.png'))!.args[1]
    const bugY = (r: RecordedCall[]) => {
      const fill = r.findIndex((c) => c.name === 'fill' && c.fillStyle === OFFICE_VIRUS_COLORS.body)
      return r.slice(0, fill).findLast((c) => c.name === 'ellipse')?.args[1]
    }

    it('hops a bug on the red screen and shakes the desk, and both go once CI is green', () => {
      const [a, b] = [painted(true, 0.31), painted(true, 0.58)]
      expect(a.fills()).toContain(OFFICE_VIRUS_COLORS.body)
      expect(bugY(a.calls)).not.toBe(bugY(b.calls))
      expect(deskX(a.calls)).not.toBe(deskX(b.calls))
      const green = [painted(false, 0.31), painted(false, 0.58)]
      expect(green[0]!.fills()).not.toContain(OFFICE_VIRUS_COLORS.body)
      expect(deskX(green[0]!.calls)).toBe(deskX(green[1]!.calls))
    })

    it('neither shakes nor bugs a red-CI desk whose member is away or held, its screen saying why', () => {
      for (const who of [{ away: true as const }, { hold: 'limited' as const }]) {
        const at = (t: number) => {
          const painter = createImagePainter({
            art: {
              style: style({ props: { station: 'desk.png', stationScreen: screen } }),
              images: IMAGES
            },
            colors: COLORS,
            builds: 'office'
          })
          const r = recordingContext()
          const actors = [actor('m', { pose: 'idle', x: spot.x, depth: spot.depth, ...who })]
          painter.paint(r.g, frame({ t, actors, stations: [spot], sites: [site(true)] }))
          return r
        }
        expect(deskX(at(0.31).calls)).toBe(deskX(at(0.58).calls))
        expect(at(0.31).fills()).not.toContain(OFFICE_VIRUS_COLORS.body)
      }
    })

    it('leaves red CI in a castle build to the slime, never a virus', () => {
      expect(painted(true, 0.31, 'castle').fills()).not.toContain(OFFICE_VIRUS_COLORS.body)
    })
  })
})

describe('createImagePainter office back view', () => {
  const screen = { x: 172, y: 24, width: 56, height: 36 }
  const spot = { x: 0.5, depth: 1 }
  const px = 76 / 128
  const officeStyle = style({
    props: { station: 'desk.png', stationFeet: { x: 120, y: 120 }, stationScreen: screen }
  })
  const paint = (actors: TeamSceneActor[], back: { chairEnd: number } | null, sites = []) => {
    const painter = createImagePainter({
      art: { style: officeStyle, images: IMAGES },
      colors: COLORS,
      builds: 'office',
      back
    })
    const r = recordingContext()
    painter.paint(r.g, frame({ actors, stations: [spot], sites }))
    return r
  }
  const memberSprites = (calls: RecordedCall[]) =>
    sprites(calls).filter(
      (c) => c.args[0] === IMAGES.get('m1.png') || c.args[0] === IMAGES.get('m2.png')
    )
  const seated = (pose: TeamSceneActor['pose']) =>
    actor('m', { pose, x: spot.x, depth: spot.depth })

  it('draws a seated member from behind, not from its sheet, and a walking one from its sheet', () => {
    const back = { chairEnd: 144 }
    for (const pose of ['work', 'idle', 'raise', 'done'] as const) {
      expect(memberSprites(paint([seated(pose)], back).calls)).toHaveLength(0)
    }
    expect(memberSprites(paint([seated('walk')], back).calls)).toHaveLength(1)
    expect(memberSprites(paint([seated('work')], null).calls)).toHaveLength(1)
  })

  it("drops the art's side chair and centres the screen on the seat", () => {
    const { calls } = paint([seated('work')], { chairEnd: 144 })
    const desk = calls.find((c) => c.name === 'drawImage' && c.args[0] === IMAGES.get('desk.png'))!
    expect(desk.args[1]).toBe(144)
    expect(desk.args[5]).toBeCloseTo(200 - (200 - 144) * px)
    const lit = calls.find((c) => c.name === 'fillRect' && c.fillStyle === '#0f1826')!
    expect((lit.args[0] as number) + (lit.args[2] as number) / 2).toBeCloseTo(200)
  })

  it('seats the back view in one long row of desks that keep members at them', () => {
    const at = (back: { chairEnd: number } | null) =>
      createImagePainter({
        art: { style: officeStyle, images: IMAGES },
        colors: COLORS,
        builds: 'office',
        back
      }).layout
    expect(at({ chairEnd: 144 })).toEqual({
      rowSize: 5,
      workSeated: true,
      firstX: 0.16,
      attendReachPx: 14,
      attendMarkDxPx: -20
    })
    expect(at(null)).toBeUndefined()
  })

  it('keeps five desks apart at the narrowest panel, so no desk covers another', () => {
    const plan = seatPlanOf(
      Array.from({ length: 5 }, (_, i) => ({
        key: `m${i}`,
        name: `m${i}`,
        characterKey: null,
        activity: 'working' as const,
        reportId: null,
        mergedPr: null,
        site: { stage: 0 as const, broken: false }
      })),
      5
    )
    // Orca's Office people stand 60 px tall, as office/native.json draws them.
    const real = (sheets: string[]) => ({ ...role(sheets), size: 60 })
    const roles = { lead: real(['lead.png']), member: real(['m1.png', 'm2.png']) }
    const painter = createImagePainter({
      art: { style: { ...officeStyle, roles }, images: IMAGES },
      colors: COLORS,
      builds: null,
      back: { chairEnd: 144 }
    })
    // Why 320 too: the narrowest panel shrinks the row so its desks still keep a gap.
    for (const width of [390, 320]) {
      const r = recordingContext()
      painter.paint(r.g, frame({ width, actors: [], stations: plan.seats.map((s) => s.spot) }))
      const desks = r.calls
        .filter((c) => c.name === 'drawImage' && c.args[0] === IMAGES.get('desk.png'))
        .map((c) => [c.args[5] as number, (c.args[5] as number) + (c.args[7] as number)])
        .sort((p, q) => p[0]! - q[0]!)
      expect(desks).toHaveLength(5)
      for (let i = 1; i < desks.length; i++) {
        expect(desks[i]![0], `${width} px`).toBeGreaterThan(desks[i - 1]![1]!)
      }
    }
  })

  it("says where a sitter's emote is drawn, so its name tag can hang over it", () => {
    const asking = actor('m', { pose: 'raise', x: spot.x, depth: spot.depth, emote: 'alert' })
    const painter = createImagePainter({
      art: { style: officeStyle, images: IMAGES },
      colors: COLORS,
      builds: 'office',
      back: { chairEnd: 144 }
    })
    const r = recordingContext()
    const f = frame({ actors: [asking], stations: [spot] })
    painter.paint(r.g, f)
    const drawn = r.calls.findLast((c) => c.name === 'translate')!
    expect(painter.emoteAt?.(asking, f)).toEqual({ x: drawn.args[0], y: drawn.args[1] })
    expect(painter.emoteAt?.({ ...asking, pose: 'walk' }, f)).toBeNull()
  })

  it("hangs a sitter's emote beside its monitor, never over the screen", () => {
    const asking = actor('m', { pose: 'raise', x: spot.x, depth: spot.depth, emote: 'alert' })
    const { calls } = paint([asking], { chairEnd: 144 })
    const emote = calls.findLast((c) => c.name === 'translate')!
    const screenLeft = 200 - (screen.width / 2) * px
    expect((emote.args[0] as number) + 7).toBeLessThan(screenLeft)
  })

  it('leaves no paper tray on the floor where members work seated, and keeps it otherwise', () => {
    const site = {
      key: 'm',
      spot: { x: spot.x + 0.055, depth: 1 },
      stage: 2 as const,
      broken: false
    }
    const trays = (back: { chairEnd: number } | null) =>
      paint([seated('work')], back, [site] as never[]).calls.filter(
        (c) => c.name === 'fillRect' && c.fillStyle === OFFICE_TRAY
      )
    expect(trays({ chairEnd: 144 })).toHaveLength(0)
    expect(trays(null)).toHaveLength(1)
  })

  it('drops the blocked mark over a held Office seat, its screen saying why instead', () => {
    const asleep = actor('m', {
      pose: 'idle',
      x: spot.x,
      depth: spot.depth,
      emote: 'blocked',
      hold: 'asleep'
    })
    const fills = paint([asleep], { chairEnd: 144 }).calls.map((c) => c.fillStyle)
    expect(fills).not.toContain(COLORS.risk)
    const blocked = actor('m', { pose: 'idle', x: spot.x, depth: spot.depth, emote: 'blocked' })
    expect(paint([blocked], { chairEnd: 144 }).calls.map((c) => c.fillStyle)).toContain(COLORS.risk)
  })

  it('dims a desk another session holds, and leaves a free one as it is', () => {
    const alphaAtDesk = (taken: boolean) => {
      const r = recordingContext()
      const alphas: number[] = []
      const g = new Proxy(r.g, {
        get(target, prop) {
          if (prop === 'drawImage') {
            return (...args: unknown[]) => {
              if (args[0] === IMAGES.get('desk.png')) {
                alphas.push(target.globalAlpha)
              }
            }
          }
          return Reflect.get(target, prop)
        }
      })
      const painter = createImagePainter({
        art: { style: officeStyle, images: IMAGES },
        colors: COLORS,
        builds: 'office',
        back: { chairEnd: 144 }
      })
      const station = { ...spot, ...(taken ? { taken: true as const } : {}) }
      g.globalAlpha = 1
      painter.paint(g, frame({ actors: [], stations: [station] }))
      return alphas[0]
    }
    expect(alphaAtDesk(true)).toBeLessThan(1)
    expect(alphaAtDesk(false)).toBe(1)
  })

  it('leaves a coat on the chair of a desk another session holds, and a free desk clean', () => {
    const coatAt = (taken: boolean) => {
      const painter = createImagePainter({
        art: { style: officeStyle, images: IMAGES },
        colors: COLORS,
        builds: 'office',
        back: { chairEnd: 144 }
      })
      const r = recordingContext()
      const station = { ...spot, ...(taken ? { taken: true as const } : {}) }
      painter.paint(r.g, frame({ actors: [], stations: [station] }))
      return r.fills()
    }
    expect(coatAt(true)).toContain(OFFICE_COAT)
    expect(coatAt(false)).not.toContain(OFFICE_COAT)
  })

  it('keeps the red screen of failing CI behind a member seen from behind', () => {
    const site = {
      key: 'm',
      spot: { x: spot.x + 0.055, depth: 1 },
      stage: 3 as const,
      broken: true
    }
    const fills = paint([seated('work')], { chairEnd: 144 }, [site] as never[])
      .calls.filter((c) => c.name === 'fillRect')
      .map((c) => c.fillStyle)
    expect(fills).toContain('#2a1012')
    expect(fills).toContain(COLORS.attention)
  })
})

// Why: past the backdrop's own width at the stage height, cover scales it up, the window and city
// rise out of view and the art's edges fill the floor (building at a 1120 px panel, 2026-11-11).
describe('the widest stage a style draws whole', () => {
  it("is the backdrop's own width at the stage's height", () => {
    // sky.png is 1536 x 352: at the 176 px stage, 768 px.
    expect(painterOf().maxWidth).toBe(768)
  })
})
