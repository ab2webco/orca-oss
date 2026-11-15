import { describe, expect, it } from 'vitest'
import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneVerdictTone
} from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneFrame } from './team-scene-painter'
import { recordingContext } from './team-scene-recording-context'
import {
  createVerdictFlights,
  drawVerdictScreen,
  VERDICT_FLIGHT_SECONDS
} from './team-scene-verdict-flights'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }
const DT = 1 / 30
const feetY = (depth: number, h: number) => h - 36 + depth * 22

const actor = (key: string, x: number): TeamSceneActor => ({
  key,
  role: key === 'advisor' ? 'advisor' : 'member',
  name: key,
  characterKey: null,
  x,
  depth: 0.5,
  facing: 1,
  pose: 'idle',
  gait: 0,
  stride: 8,
  carrying: false,
  emote: null,
  jump: 0
})
const ACTORS = [
  actor('advisor', 0.7),
  actor('a', 0.2),
  actor('b', 0.4),
  actor('c', 0.5),
  actor('d', 0.6)
]
const frame = (t: number): TeamSceneFrame => ({
  width: 400,
  height: 176,
  ratio: 1,
  t,
  dt: DT,
  actors: ACTORS,
  effects: [],
  overflow: 0,
  stations: [],
  sites: [],
  trophies: []
})
const verdict = (to: string, tone: TeamSceneVerdictTone = 'allow'): TeamSceneEffect => ({
  kind: 'verdict',
  to,
  tone
})

/** Steps the flights `seconds`, returning the token fills drawn on each frame. */
function fly(flights: ReturnType<typeof createVerdictFlights>, from: number, seconds: number) {
  const frames: unknown[][] = []
  for (let t = from; t < from + seconds; t += DT) {
    const r = recordingContext()
    flights.draw(r.g, frame(t))
    frames.push(r.fills())
  }
  return frames
}

// ORCA-1218: a Jev decision visibly reaches the judged member's desk within a second.
describe('verdict flights', () => {
  it("lands on the member's desk inside a second, in the decision's colour, then its monitor reacts", () => {
    const flights = createVerdictFlights(feetY, COLORS)
    flights.start([verdict('a', 'deny')], ACTORS)
    expect(VERDICT_FLIGHT_SECONDS).toBeLessThan(1)
    const frames = fly(flights, 0, VERDICT_FLIGHT_SECONDS + DT)
    expect(frames[0]).toContain(COLORS.attention)
    expect(flights.landedOn('a', VERDICT_FLIGHT_SECONDS + 0.1)).toMatchObject({
      tone: 'deny',
      color: COLORS.attention
    })
    expect(flights.landedOn('b', VERDICT_FLIGHT_SECONDS + 0.1)).toBeUndefined()
    expect(flights.landedOn('a', VERDICT_FLIGHT_SECONDS + 5)).toBeUndefined()
  })

  it('coalesces a burst: one token a member, recoloured, and at most three in the air', () => {
    const flights = createVerdictFlights(feetY, COLORS)
    flights.start([verdict('a', 'allow')], ACTORS)
    flights.start([verdict('a', 'ask'), verdict('b'), verdict('c'), verdict('d')], ACTORS)
    const tokens = fly(flights, 0, 0.6).map(
      (fills) => fills.filter((one) => one !== '#ffffff').length
    )
    expect(Math.max(...tokens)).toBe(3)
    fly(flights, 0.6, VERDICT_FLIGHT_SECONDS)
    expect(flights.landedOn('a', 1)?.tone).toBe('ask')
    expect(flights.landedOn('d', 1)).toBeUndefined()
  })

  it('throws nothing without an advisor on the stage', () => {
    const flights = createVerdictFlights(feetY, COLORS)
    flights.start([verdict('a')], ACTORS.slice(1))
    expect(fly(flights, 0, 0.3).flat()).toEqual([])
  })

  it("marks a monitor with a tick, a cross or a bar in the decision's colour", () => {
    const rect = { x: 0, y: 0, width: 28, height: 18 }
    const strokes = (tone: TeamSceneVerdictTone) => {
      const r = recordingContext()
      drawVerdictScreen(r.g, rect, { tone, color: '#123456', p: 0.5 })
      return r.calls.filter((c) => c.name === 'stroke').length
    }
    expect(strokes('allow')).toBe(1)
    expect(strokes('deny')).toBe(2)
    expect(strokes('ask')).toBe(2)
    expect(strokes('note')).toBe(0)
  })
})
