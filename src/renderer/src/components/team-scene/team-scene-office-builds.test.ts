import { describe, expect, it } from 'vitest'
import {
  SITE_FROM_SEAT_X,
  type TeamSceneSiteStage
} from '../../../../shared/team-scene/team-scene-sites'
import {
  drawOfficeBoard,
  drawOfficeBuilds,
  drawOfficePlaques,
  drawOfficeTray,
  OFFICE_NOTE,
  OFFICE_STAR
} from './team-scene-office-builds'
import { recordingContext } from './team-scene-recording-context'

const ATTENTION = '#ff0001'
const board = (stage: TeamSceneSiteStage, broken = false) => {
  const r = recordingContext()
  drawOfficeBoard(r.g, 100, 60, 1, { stage, broken }, 0, ATTENTION)
  return r
}
const rects = (r: ReturnType<typeof recordingContext>, color: string) =>
  r.calls.filter((c) => c.name === 'fillRect' && c.fillStyle === color)
// A note's column is its x: to do, doing, done from left to right.
const doneNotes = (stage: TeamSceneSiteStage) => {
  const xs = rects(board(stage), OFFICE_NOTE).map((c) => c.args[0] as number)
  const right = Math.max(...xs, -Infinity)
  return xs.filter((x) => x === right).length
}

describe('office builds', () => {
  it('fills the board as the work moves on, notes sliding to the done column', () => {
    expect(rects(board(0), OFFICE_NOTE)).toHaveLength(0)
    expect(rects(board(1), OFFICE_NOTE).length).toBeGreaterThan(0)
    const done = ([2, 3, 4] as const).map(doneNotes)
    expect(done[1]).toBeGreaterThan(done[0]!)
    expect(done[2]).toBeGreaterThanOrEqual(done[1]!)
  })

  it('pins the star only once the work is merged', () => {
    for (const stage of [0, 1, 2, 3] as const) {
      expect(board(stage).fills()).not.toContain(OFFICE_STAR)
    }
    expect(board(4).fills()).toContain(OFFICE_STAR)
  })

  it('shows a red note while CI is red, and only then', () => {
    expect(rects(board(3, true), ATTENTION).length).toBeGreaterThan(0)
    expect(rects(board(3), ATTENTION)).toHaveLength(0)
  })

  it('draws a paper tray to fetch from', () => {
    const r = recordingContext()
    drawOfficeTray(r.g, 60, 150, 1)
    expect(r.calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThanOrEqual(2)
  })

  it('hangs each board over its desk monitor, however far the monitor sits from the seat', () => {
    const site = {
      key: 'm',
      spot: { x: 0.5 + SITE_FROM_SEAT_X, depth: 1 },
      stage: 1 as const,
      broken: false
    }
    const boardX = (monitor: number) => {
      const r = recordingContext()
      const f = { width: 400, height: 176, t: 0, sites: [site], trophies: [] }
      drawOfficeBuilds(
        r.g,
        f,
        () => 150,
        ATTENTION,
        () => monitor
      )
      // The tray is translated first, then the board.
      return r.calls.filter((c) => c.name === 'translate')[1]!.args[0] as number
    }
    expect(boardX(0)).toBeCloseTo(200)
    expect(boardX(30)).toBeCloseTo(230)
  })

  it('hangs one framed star per trophy along the top', () => {
    const r = recordingContext()
    drawOfficePlaques(r.g, 3, 420, 0)
    expect(r.fills().filter((f) => f === OFFICE_STAR)).toHaveLength(3)
    const none = recordingContext()
    drawOfficePlaques(none.g, 0, 420, 0)
    expect(none.calls).toHaveLength(0)
  })
})
