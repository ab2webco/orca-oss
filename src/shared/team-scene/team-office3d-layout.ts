import { stableOrderOf } from './team-diorama-layout'
import type { TeamSceneFloor } from './team-scene-floors'

// Why one module: the 3D Office (ORCA-1302) places every floor, seat, room and the lift here, so
// the renderer only draws and the walkers' routes are tested without WebGL.

/** World units: x along the row of desks, z toward the viewer, a floor's top at its `y`. */
export type Office3dPoint = [number, number]

/** A floor's ceiling height and depth; floors stack `OFFICE3D_PITCH` apart so a slab never hides
 * the boards of the floor under it at the camera's angle. */
export const OFFICE3D_HEIGHT = 3.5
export const OFFICE3D_DEPTH = 5.6
export const OFFICE3D_PITCH = 9
/** Where a seated member's chair stands, the aisle the lead walks, and each floor's lift door. */
export const OFFICE3D_SEAT_Z = 1.85
export const OFFICE3D_AISLE_Z = 4
export const OFFICE3D_DOOR_Z = 4.1
/** The glass lift beside every floor's door; one car for the whole building. */
export const OFFICE3D_LIFT: Office3dPoint = [-1.15, OFFICE3D_DOOR_Z]
/** The wing beside the desks: the lead's office, and a control room where its Jev runs. */
export const OFFICE3D_WING_WIDTH = 3.9
/** How high the lead floor's control room sits: a balcony over the lead's office. */
export const OFFICE3D_BALCONY_Y = 4.6

const SEAT_PITCH = 2.2
const MIN_SEATS = 5
const MIN_WIDTH = 11.7
const MAX_WIDTH = 14.4

export type Office3dSeat = {
  /** A member's pane key; null for another session's desk or a free one. */
  key: string | null
  kind: 'member' | 'taken' | 'free'
  /** The chair's x on its floor. */
  x: number
}

/** Jev's room on a floor: a balcony over the lead's office, or a room at floor level. */
export type Office3dControlRoom = { x: number; y: number; balcony: boolean; chair: Office3dPoint }

export type Office3dFloor = {
  /** The floor's key from `teamSceneFloorsOf`: '' for this machine, else the host's name. */
  key: string
  name: string
  lead: boolean
  reachable: boolean
  /** The floor's top. */
  y: number
  width: number
  /** How much each desk and sitter is scaled so a crowded row keeps its gaps. */
  scale: number
  seats: Office3dSeat[]
  /** Members, taken and free desks, as the floor's chip prints them. */
  used: number
  /** The lead's office: only on the lead's floor. */
  office: { x: number; desk: Office3dPoint } | null
  /** Null where this machine's Jev has not reported: no room is drawn, the desks run to the wall. */
  controlRoom: Office3dControlRoom | null
}

export type Office3dLayout = {
  floors: Office3dFloor[]
  /** The order each floor's seats were last in, fed back on the next read. */
  order: Record<string, (string | null)[]>
}

/**
 * Whether a floor draws its Jev. Jev is a plugin hook per session, so each machine has its own,
 * and it shows only where it has spoken: the team's Jev row on the lead's floor, else a decision
 * Jev made in one of that floor's panes. Why not a host flag: the model has none, and a plugin
 * that has not yet decided looks the same as no plugin.
 */
export function office3dHasAdvisor(floor: TeamSceneFloor, leadAdvisor: boolean): boolean {
  if (floor.lead && leadAdvisor) {
    return true
  }
  return floor.members.some((m) => (m.decisions?.length ?? 0) > 0)
}

/** The floor's width for `seats` desks: wider with more desks, never past what the panel holds. */
export const office3dFloorWidth = (seats: number): number =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, SEAT_PITCH * seats + 0.7))

function seatsOf(
  floor: TeamSceneFloor,
  previous: readonly (string | null)[]
): { seats: Office3dSeat[]; order: (string | null)[]; width: number; scale: number } {
  const order = stableOrderOf(
    floor.members.map((m) => m.paneKey),
    previous
  )
  const members = order.filter((key) => key !== null).length
  const total = Math.max(MIN_SEATS, members + floor.taken + floor.free)
  const width = office3dFloorWidth(total)
  const pitch = (width - 0.65) / total
  const keys = [...order]
  // Why holes first: a member that left keeps its desk free until another takes it.
  while (keys.length < total) {
    keys.push(null)
  }
  let taken = floor.taken
  const seats = keys.slice(0, total).map((key, i): Office3dSeat => {
    const x = 0.3 + pitch * (i + 0.5)
    if (key !== null) {
      return { key, kind: 'member', x }
    }
    if (taken > 0) {
      taken -= 1
      return { key: null, kind: 'taken', x }
    }
    return { key: null, kind: 'free', x }
  })
  return { seats, order, width, scale: Math.min(1, pitch / SEAT_PITCH) }
}

function controlRoomOf(floor: TeamSceneFloor, y: number, width: number): Office3dControlRoom {
  const balcony = floor.lead
  const chairX = width + (balcony ? 1.6 : OFFICE3D_WING_WIDTH / 2)
  return { x: width, y: balcony ? y + OFFICE3D_BALCONY_Y : y, balcony, chair: [chairX, 2] }
}

/**
 * The building: the lead's floor first at the bottom, then each machine, as `teamSceneFloorsOf`
 * orders them. `previous` keeps every member on the desk it had.
 */
export function teamOffice3dLayoutOf(
  floors: readonly TeamSceneFloor[],
  args: { leadAdvisor: boolean; previous?: Record<string, (string | null)[]> }
): Office3dLayout {
  const order: Record<string, (string | null)[]> = {}
  const built = floors.map((floor, i): Office3dFloor => {
    const y = i * OFFICE3D_PITCH
    const placed = seatsOf(floor, args.previous?.[floor.key] ?? [])
    order[floor.key] = placed.order
    const advisor = office3dHasAdvisor(floor, args.leadAdvisor)
    return {
      key: floor.key,
      name: floor.host.kind === 'remote' ? floor.host.name : '',
      lead: floor.lead,
      reachable: floor.reachable,
      y,
      width: placed.width,
      scale: placed.scale,
      seats: placed.seats,
      used: floor.members.length + floor.taken,
      office: floor.lead
        ? { x: placed.width, desk: [placed.width + OFFICE3D_WING_WIDTH / 2, 1.65] }
        : null,
      controlRoom: advisor ? controlRoomOf(floor, y, placed.width) : null
    }
  })
  return { floors: built, order }
}

/** Where a seat's sitter stands for the lead to talk to it: just behind the chair, in the aisle. */
export const office3dStandBehind = (seat: Office3dSeat): Office3dPoint => [
  seat.x + 0.15,
  OFFICE3D_SEAT_Z + 1.25
]
