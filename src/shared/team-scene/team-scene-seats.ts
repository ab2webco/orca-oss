import type { TeamSceneMemberInput, TeamSceneSpot, TeamSceneStation } from './team-scene-types'

const ROW_SIZE = 4
// Why: an estimate from the prototype; ORCA-1051 verifies it at real panel width.
export const TEAM_SCENE_MAX_SEATS = 8

const BACK_ROW = 0.3
const FRONT_ROW = 0.85
const SINGLE_ROW = 0.55
// Stations fill the left; the lead and advisor own the right edge.
const FIRST_X = 0.1
// Why 0.58: the staggered front row then ends at 0.66, clear of the advisor at 0.74.
const LAST_X = 0.58

export type TeamSceneSeat = { key: string; spot: TeamSceneSpot }

export type TeamSceneSeatPlan = {
  seats: TeamSceneSeat[]
  /** Desks with none of this team at them. */
  empty: TeamSceneStation[]
  overflow: number
}

/** Needs-you first so the +N never hides someone waiting on the user. */
export function seatPlanOf(
  members: readonly TeamSceneMemberInput[],
  /** Seats in one row before a second opens; a style with wide desks keeps a long row. */
  rowSize = ROW_SIZE,
  /** Where the row starts; a style that needs room at its left end starts it further in. */
  firstX = FIRST_X,
  /** Empty desks after the members', taken ones first, within the seats the stage holds. */
  desks: { taken: number; free: number } = { taken: 0, free: 0 }
): TeamSceneSeatPlan {
  const spacing = (LAST_X - FIRST_X) / (rowSize - 1)
  const columnX = (column: number): number => firstX + spacing * column
  // Why half a column: a front-row member standing right before a back-row seat hid it.
  const frontShift = spacing / 2
  const ordered = [
    ...members.filter((m) => m.activity === 'needsYou'),
    ...members.filter((m) => m.activity !== 'needsYou')
  ]
  const shown = ordered.slice(0, TEAM_SCENE_MAX_SEATS)
  const room = TEAM_SCENE_MAX_SEATS - shown.length
  const taken = Math.min(desks.taken, room)
  const free = Math.min(desks.free, room - taken)
  const twoRows = shown.length + taken + free > rowSize
  const spotAt = (i: number): TeamSceneSpot => ({
    x: columnX(i % rowSize) + (twoRows && i >= rowSize ? frontShift : 0),
    depth: twoRows ? (i < rowSize ? BACK_ROW : FRONT_ROW) : SINGLE_ROW
  })
  const seats = shown.map((m, i) => ({ key: m.key, spot: spotAt(i) }))
  const empty = Array.from(
    { length: taken + free },
    (_, i): TeamSceneStation => ({
      ...spotAt(shown.length + i),
      ...(i < taken ? { taken: true as const } : {})
    })
  )
  return { seats, empty, overflow: ordered.length - shown.length }
}
