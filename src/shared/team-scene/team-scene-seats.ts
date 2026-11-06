import type { TeamSceneMemberInput, TeamSceneSpot } from './team-scene-types'

const ROW_SIZE = 4
// Why: an estimate from the prototype; ORCA-1051 verifies it at real panel width.
export const TEAM_SCENE_MAX_SEATS = 8

const BACK_ROW = 0.3
const FRONT_ROW = 0.85
const SINGLE_ROW = 0.55
// Stations fill the left; the lead and advisor own the right edge.
const FIRST_X = 0.1
const LAST_X = 0.64

export type TeamSceneSeat = { key: string; spot: TeamSceneSpot }

export type TeamSceneSeatPlan = { seats: TeamSceneSeat[]; overflow: number }

const SPACING = (LAST_X - FIRST_X) / (ROW_SIZE - 1)
const columnX = (column: number): number => FIRST_X + SPACING * column
// Why half a column: a front-row member standing right before a back-row seat hid it.
const FRONT_SHIFT = SPACING / 2

/** Needs-you first so the +N never hides someone waiting on the user. */
export function seatPlanOf(members: readonly TeamSceneMemberInput[]): TeamSceneSeatPlan {
  const ordered = [
    ...members.filter((m) => m.activity === 'needsYou'),
    ...members.filter((m) => m.activity !== 'needsYou')
  ]
  const shown = ordered.slice(0, TEAM_SCENE_MAX_SEATS)
  const twoRows = shown.length > ROW_SIZE
  const seats = shown.map((m, i) => ({
    key: m.key,
    spot: {
      x: columnX(i % ROW_SIZE) + (twoRows && i >= ROW_SIZE ? FRONT_SHIFT : 0),
      depth: twoRows ? (i < ROW_SIZE ? BACK_ROW : FRONT_ROW) : SINGLE_ROW
    }
  }))
  return { seats, overflow: ordered.length - shown.length }
}
