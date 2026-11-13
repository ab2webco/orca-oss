// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { createFiguresPainter } from './team-scene-figures-painter'
import type { TeamSceneFrame } from './team-scene-painter'
import { recordingContext } from './team-scene-recording-context'
import { CASTLE_BANNER } from './team-scene-castle-sites'
import { SCENE_DUST } from './team-scene-painter-marks'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }

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
const frame = (extra: Partial<TeamSceneFrame> = {}): TeamSceneFrame => ({
  width: 360,
  height: 176,
  ratio: 2,
  t: 1,
  dt: 1 / 30,
  actors: [actor('a'), actor('lead')],
  effects: [],
  overflow: 0,
  stations: [{ x: 0.1, depth: 0.5 }],
  sites: [],
  trophies: [],
  ...extra
})

let backdrops = 0
beforeEach(() => {
  backdrops = 0
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') {
      backdrops++
    }
    return create(tag)
  }) as typeof document.createElement)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g)
})
afterEach(() => vi.restoreAllMocks())

describe('createFiguresPainter', () => {
  it('builds the backdrop once per size and again after dispose', () => {
    const painter = createFiguresPainter(COLORS)
    const { g } = recordingContext()
    painter.paint(g, frame())
    painter.paint(g, frame())
    // The backdrop and the one cloud sprite.
    expect(backdrops).toBe(2)
    painter.paint(g, frame({ width: 300 }))
    expect(backdrops).toBe(3)
    painter.dispose()
    painter.paint(g, frame({ width: 300 }))
    expect(backdrops).toBe(5)
  })

  it('marks a member who needs the user with the attention colour', () => {
    const painter = createFiguresPainter(COLORS)
    const calm = recordingContext()
    painter.paint(calm.g, frame())
    const asking = recordingContext()
    painter.paint(asking.g, frame({ actors: [actor('a', { pose: 'raise', emote: 'alert' })] }))
    expect(calm.fills()).not.toContain(COLORS.attention)
    expect(asking.fills()).toContain(COLORS.attention)
  })

  it('throws the report from the member to the lead, then drops it', () => {
    const painter = createFiguresPainter(COLORS)
    painter.paint(
      recordingContext().g,
      frame({ effects: [{ kind: 'handoff', from: 'a', to: 'lead' }] })
    )
    const flying = recordingContext()
    painter.paint(flying.g, frame())
    expect(flying.calls.some((c) => c.name === 'rotate' && c.fillStyle === '#f4e6c0')).toBe(true)
    for (let i = 0; i < 30; i++) {
      painter.paint(recordingContext().g, frame())
    }
    const landed = recordingContext()
    painter.paint(landed.g, frame())
    expect(landed.calls.some((c) => c.name === 'rotate' && c.fillStyle === '#f4e6c0')).toBe(false)
  })

  it('marks a member that cannot work with the warning colour, as its card does', () => {
    const painter = createFiguresPainter(COLORS)
    const r = recordingContext()
    painter.paint(r.g, frame({ actors: [actor('a', { pose: 'idle', emote: 'blocked' })] }))
    expect(r.fills()).toContain(COLORS.risk)
  })

  it('draws each seat build at its stage, with its pile, instead of the bench', () => {
    const painter = createFiguresPainter(COLORS)
    const built = recordingContext()
    const site = { key: 'a', spot: { x: 0.155, depth: 0.5 }, stage: 4 as const, broken: false }
    painter.paint(built.g, frame({ sites: [site] }))
    expect(built.fills()).toContain(CASTLE_BANNER)
    const bench = recordingContext()
    painter.paint(bench.g, frame())
    expect(bench.fills()).not.toContain(CASTLE_BANNER)
  })

  it('keeps a finished tower on the far hills for each trophy', () => {
    const painter = createFiguresPainter(COLORS)
    const r = recordingContext()
    painter.paint(r.g, frame({ trophies: [{ key: 'x', name: 'x' }] }))
    expect(r.fills().filter((f) => f === CASTLE_BANNER)).toHaveLength(1)
  })

  it('puffs stone dust where a member builds or repairs', () => {
    const painter = createFiguresPainter(COLORS)
    painter.paint(
      recordingContext().g,
      frame({ effects: [{ kind: 'burst', key: 'a', reason: 'build' }] })
    )
    const puff = recordingContext()
    painter.paint(puff.g, frame())
    expect(puff.calls.some((c) => c.name === 'fillRect' && c.fillStyle === SCENE_DUST)).toBe(true)
  })

  it('shows members past the seats as +N', () => {
    const painter = createFiguresPainter(COLORS)
    const r = recordingContext()
    painter.paint(r.g, frame({ overflow: 3 }))
    expect(r.calls.find((c) => c.name === 'fillText')?.args[0]).toBe('+3')
    const none = recordingContext()
    painter.paint(none.g, frame())
    expect(none.calls.some((c) => c.name === 'fillText')).toBe(false)
  })
})
