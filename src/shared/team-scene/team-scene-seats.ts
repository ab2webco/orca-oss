import type { TeamSceneAttendReach } from './team-scene-lead-attend'
import type { TeamSceneMemberInput, TeamSceneSpot, TeamSceneStation } from './team-scene-types'

/** How a style seats its team: a row's length, and whether work keeps members at their desks. */
export type TeamSceneLayout = {
  rowSize: number
  workSeated: boolean
  firstX?: number
  /** Past `rowSize` the row closes up rather than opening a second one in front. */
  rowGrows?: boolean
} & TeamSceneAttendReach

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

/** The gap between neighbouring seats of a full row of `rowSize`, in stage widths. */
export const teamSceneRowSpacing = (rowSize: number): number => (LAST_X - FIRST_X) / (rowSize - 1)

/** Who holds each seat, by seat index; null is a desk its member left. */
export type TeamSceneSeatOrder = readonly (string | null)[]

export type TeamSceneSeatPlan = {
  seats: TeamSceneSeat[]
  /** Desks with none of this team at them. */
  empty: TeamSceneStation[]
  overflow: number
  /** The order to pass back next time, so every member keeps its desk. */
  order: TeamSceneSeatOrder
}

/**
 * Each member keeps the seat it had, whatever its state or place in the list: the Team model sorts
 * by status, and a seat by list index moved every desk when one member changed (ORCA-1204). A
 * newcomer takes the first free seat, needs-you first; one who needs you and finds none takes the
 * last seat from someone who does not, so the +N never hides it.
 */
export function teamSceneSeatOrderOf(
  members: readonly TeamSceneMemberInput[],
  previous: TeamSceneSeatOrder,
  max = TEAM_SCENE_MAX_SEATS
): (string | null)[] {
  const present = new Set(members.map((m) => m.key))
  const order = previous.slice(0, max).map((key) => (key !== null && present.has(key) ? key : null))
  const seated = new Set(order)
  const newcomers = [
    ...members.filter((m) => m.activity === 'needsYou'),
    ...members.filter((m) => m.activity !== 'needsYou')
  ].filter((m) => !seated.has(m.key))
  const asking = new Set(members.filter((m) => m.activity === 'needsYou').map((m) => m.key))
  for (const m of newcomers) {
    const free = order.indexOf(null)
    if (free !== -1) {
      order[free] = m.key
    } else if (order.length < max) {
      order.push(m.key)
    } else if (asking.has(m.key)) {
      const bumped = order.findLastIndex((key) => key !== null && !asking.has(key))
      if (bumped !== -1) {
        order[bumped] = m.key
      }
    }
  }
  while (order.length > 0 && order.at(-1) === null) {
    order.pop()
  }
  return order
}

/** Needs-you first so the +N never hides someone waiting on the user. */
export function seatPlanOf(
  members: readonly TeamSceneMemberInput[],
  /** Seats in one row before a second opens; a style with wide desks keeps a long row. */
  rowSize = ROW_SIZE,
  /** Where the row starts; a style that needs room at its left end starts it further in. */
  firstX = FIRST_X,
  /** Empty desks after the members', taken ones first, within the seats the stage holds. */
  desks: { taken: number; free: number } = { taken: 0, free: 0 },
  /** The last plan's order, so a member keeps its seat; empty seats everyone afresh. */
  previous: TeamSceneSeatOrder = [],
  /** One row that closes up past `rowSize` instead of opening a second. */
  grows = false
): TeamSceneSeatPlan {
  const order = teamSceneSeatOrderOf(members, previous)
  const room = TEAM_SCENE_MAX_SEATS - order.length
  const taken = Math.min(desks.taken, room)
  const free = Math.min(desks.free, room - taken)
  const total = order.length + taken + free
  const perRow = grows ? Math.max(rowSize, total) : rowSize
  const spacing = teamSceneRowSpacing(perRow)
  const columnX = (column: number): number => firstX + spacing * column
  // Why half a column: a front-row member standing right before a back-row seat hid it.
  const frontShift = spacing / 2
  const twoRows = total > perRow
  const spotAt = (i: number): TeamSceneSpot => ({
    x: columnX(i % perRow) + (twoRows && i >= perRow ? frontShift : 0),
    depth: twoRows ? (i < perRow ? BACK_ROW : FRONT_ROW) : SINGLE_ROW
  })
  const seats = order.flatMap((key, i) => (key === null ? [] : [{ key, spot: spotAt(i) }]))
  // Why a left member's desk stays: closing the gap would move everyone after it.
  const left = order.flatMap((key, i): TeamSceneStation[] => (key === null ? [spotAt(i)] : []))
  const empty = [
    ...left,
    ...Array.from(
      { length: taken + free },
      (_, i): TeamSceneStation => ({
        ...spotAt(order.length + i),
        ...(i < taken ? { taken: true as const } : {})
      })
    )
  ]
  return { seats, empty, overflow: members.length - seats.length, order }
}

/** The plan for a style's `layout`, each member kept at the seat `previous` gave it. */
export const seatPlanForLayout = (
  members: readonly TeamSceneMemberInput[],
  layout: TeamSceneLayout,
  desks: { taken: number; free: number } | undefined,
  previous: TeamSceneSeatOrder
): TeamSceneSeatPlan =>
  seatPlanOf(members, layout.rowSize, layout.firstX, desks, previous, layout.rowGrows)
