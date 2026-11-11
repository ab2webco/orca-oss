import { describe, expect, it } from 'vitest'
import type { TeamScenePlay, TeamScenePose } from '../../../../shared/team-scene/team-scene-types'
import {
  drawOfficeBack,
  OFFICE_BACK_FALLBACK,
  OFFICE_BACK_HEAD_TOP,
  officeBackLookOf
} from './team-scene-office-back'
import { OFFICE_PLAY_COLORS } from './team-scene-office-play'
import { recordingContext } from './team-scene-recording-context'

const LOOK = { hair: '#211816', skin: '#8a5a3c', shirt: '#bc743f' }
const PX = 0.5
const FLOOR = 150

// A 128-wide frame, transparent but for the points a look is read from.
function frameWith(points: [number, number, [number, number, number]][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(128 * 128 * 4)
  for (const [x, y, [r, g, b]] of points) {
    data.set([r, g, b, 255], (y * 128 + x) * 4)
  }
  return data
}

const drawn = (pose: TeamScenePose, t = 0, jump = 0) => {
  const r = recordingContext()
  drawOfficeBack(r.g, 100, FLOOR, PX, LOOK, { pose, jump }, t)
  return r
}
// Each disc is an arc then its fill: the arc's centre and the colour it was filled with.
const discs = (r: ReturnType<typeof recordingContext>) =>
  r.calls.flatMap((c, i) =>
    c.name === 'arc' && r.calls[i + 1]?.name === 'fill'
      ? [{ x: c.args[0] as number, y: c.args[1] as number, color: r.calls[i + 1]!.fillStyle }]
      : []
  )
const headTopY = FLOOR - OFFICE_BACK_HEAD_TOP * PX

describe('office back view', () => {
  it("reads hair, skin and shirt from the member's own idle frame", () => {
    const data = frameWith([
      [62, 41, [0x21, 0x18, 0x16]],
      [70, 56, [0x8a, 0x5a, 0x3c]],
      [62, 82, [0xbc, 0x74, 0x3f]]
    ])
    expect(officeBackLookOf(data, 128)).toEqual(LOOK)
  })

  it('falls back to a plain look where the frame has nothing to read', () => {
    expect(officeBackLookOf(new Uint8ClampedArray(128 * 128 * 4), 128)).toEqual(
      OFFICE_BACK_FALLBACK
    )
    expect(officeBackLookOf(undefined, 128)).toEqual(OFFICE_BACK_FALLBACK)
  })

  it('shows the back of the head in hair, with no face', () => {
    const r = drawn('work')
    const head = discs(r).find((d) => d.color === LOOK.hair)
    expect(head?.x).toBeCloseTo(100)
    expect(head!.y).toBeLessThan(FLOOR)
    expect(r.calls.some((c) => c.name === 'ellipse')).toBe(false)
  })

  it('raises a hand above the head to ask, and both to cheer', () => {
    const above = (pose: TeamScenePose) =>
      discs(drawn(pose)).filter((d) => d.color === LOOK.skin && d.y < headTopY)
    expect(above('raise')).toHaveLength(1)
    expect(above('cheer')).toHaveLength(2)
    expect(above('work')).toHaveLength(0)
    expect(above('idle')).toHaveLength(0)
  })

  it('types while working, rests idle, and leans back with hands behind the head when done', () => {
    const shape = (pose: TeamScenePose, t = 0) => JSON.stringify(drawn(pose, t).calls)
    expect(shape('work', 0)).not.toBe(shape('work', 0.1))
    expect(shape('idle', 0)).toBe(shape('idle', 0.1))
    expect(shape('done')).not.toBe(shape('idle'))
    expect(shape('work')).not.toBe(shape('idle'))
  })

  it('lifts the whole figure by its jump', () => {
    const hairY = (jump: number) =>
      discs(drawn('cheer', 0, jump)).find((d) => d.color === LOOK.hair)!.y
    expect(hairY(6)).toBeCloseTo(hairY(0) - 6)
  })

  describe('at play in the chair', () => {
    const playing = (play: TeamScenePlay, t = 0) => {
      const r = recordingContext()
      drawOfficeBack(r.g, 100, FLOOR, PX, LOOK, { pose: 'idle', jump: 0, play }, t)
      return r
    }
    const shows = (play: TeamScenePlay, color: string) => playing(play, 1).fills().includes(color)

    it('draws each play with its own prop, and leaves the game to the screen', () => {
      expect(shows('music', OFFICE_PLAY_COLORS.phones)).toBe(true)
      expect(shows('music', OFFICE_PLAY_COLORS.note)).toBe(true)
      expect(shows('sketch', OFFICE_PLAY_COLORS.pad)).toBe(true)
      expect(shows('plane', OFFICE_PLAY_COLORS.plane)).toBe(true)
      for (const color of Object.values(OFFICE_PLAY_COLORS)) {
        expect(shows('game', color)).toBe(false)
      }
    })

    it('floats its music notes up from the headphones', () => {
      const noteYs = (t: number) =>
        discs(playing('music', t))
          .filter((d) => d.color === OFFICE_PLAY_COLORS.note)
          .map((d) => d.y)
      const [early, late] = [noteYs(0.2), noteYs(0.6)]
      expect(late[0]!).toBeLessThan(early[0]!)
    })

    it('folds the plane over its head, then throws it off across the row', () => {
      const planeX = (t: number) => {
        const r = playing('plane', t)
        const at = r.calls.findIndex(
          (c) => c.name === 'fill' && c.fillStyle === OFFICE_PLAY_COLORS.plane
        )
        const start = r.calls.slice(0, at).findLast((c) => c.name === 'moveTo')!
        return start.args[0] as number
      }
      expect(Math.abs(planeX(0.5) - 100)).toBeLessThan(10)
      expect(planeX(4.4)).toBeGreaterThan(130)
    })

    it('mashes the keys for its game, faster than it types', () => {
      const shape = (t: number) => JSON.stringify(playing('game', t).calls)
      expect(shape(0)).not.toBe(shape(0.1))
      expect(discs(playing('game')).filter((d) => d.y < headTopY)).toHaveLength(0)
    })
  })
})
