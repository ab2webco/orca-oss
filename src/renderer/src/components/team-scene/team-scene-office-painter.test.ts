// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { createOfficePainter, OFFICE_SCREEN_OFF } from './team-scene-office-painter'
import type { TeamSceneFrame } from './team-scene-painter'
import { recordingContext } from './team-scene-recording-context'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3' }
const SEAT = { x: 0.1, depth: 0.55 }

const actor = (key: string, extra: Partial<TeamSceneActor> = {}): TeamSceneActor => ({
  key,
  role: key === 'lead' ? 'lead' : 'member',
  name: key,
  characterKey: null,
  x: key === 'lead' ? 0.84 : SEAT.x,
  depth: SEAT.depth,
  facing: 1,
  pose: 'work',
  gait: 0,
  stride: 6,
  carrying: false,
  emote: null,
  jump: 0,
  ...extra
})
const frame = (actors: TeamSceneActor[]): TeamSceneFrame => ({
  width: 360,
  height: 176,
  ratio: 1,
  t: 1,
  dt: 1 / 30,
  actors,
  effects: [],
  overflow: 0,
  stations: [SEAT],
  sites: [],
  trophies: []
})
const screenOf = (actors: TeamSceneActor[]): unknown[] => {
  const r = recordingContext()
  createOfficePainter(COLORS).paint(r.g, frame(actors))
  return r.calls.filter((c) => c.name === 'fillRect').map((c) => c.fillStyle)
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext().g)
})
afterEach(() => vi.restoreAllMocks())

describe('createOfficePainter', () => {
  it('lights a working desk with the working colour', () => {
    expect(screenOf([actor('a')])).toContain(COLORS.working)
  })

  it('turns the screen to the attention colour while its member needs the user', () => {
    const screen = screenOf([actor('a', { pose: 'raise', emote: 'alert' })])
    expect(screen).toContain(COLORS.attention)
    expect(screen).not.toContain(COLORS.working)
  })

  it('leaves the screen off while its seat is empty or its member only walks past', () => {
    expect(screenOf([actor('lead')])).toContain(OFFICE_SCREEN_OFF)
    expect(screenOf([actor('a', { pose: 'walk' })])).toContain(OFFICE_SCREEN_OFF)
    expect(screenOf([actor('a', { pose: 'walk' })])).not.toContain(COLORS.working)
  })

  it('lets bubbles sit above a taller office head', () => {
    const painter = createOfficePainter(COLORS)
    expect(painter.headTop(0.5, 176)).toBeLessThan(176 - 36 + 11 - 58 * 0.68)
  })
})
