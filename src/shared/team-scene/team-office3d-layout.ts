import { stableOrderOf } from './team-diorama-layout'
import type { TeamMemberCard } from '../team-panel-model-types'
import type { TeamSceneFloor } from './team-scene-floors'

/** A floor as the building reads it: each member only by its pane and Jev's decisions there. */
export type Office3dFloorInput = Omit<TeamSceneFloor, 'members'> & {
  members: readonly Pick<TeamMemberCard, 'paneKey' | 'decisions'>[]
}

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
/** The lift's call panel on the side wall by the door, and where a rider stands to press it. */
export const OFFICE3D_CALL_PANEL: Office3dPoint = [0, 3]
export const OFFICE3D_CALL: Office3dPoint = [0.55, 3.35]
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
  /** The floor's key from `teamSceneFloorsOf`: '' for this machine, else the host's name;
   * OFFICE3D_LOBBY for the shared ground floor. */
  key: string
  /** The ground floor everyone shares: the cafeteria and the games room, no desks (ORCA-1317). */
  lobby?: true
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
export function office3dHasAdvisor(floor: Office3dFloorInput, leadAdvisor: boolean): boolean {
  if (floor.lead && leadAdvisor) {
    return true
  }
  return floor.members.some((m) => (m.decisions?.length ?? 0) > 0)
}

/** The floor's width for `seats` desks: wider with more desks, never past what the panel holds. */
export const office3dFloorWidth = (seats: number): number =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, SEAT_PITCH * seats + 0.7))

function seatsOf(
  floor: Office3dFloorInput,
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

function controlRoomOf(floor: Office3dFloorInput, y: number, width: number): Office3dControlRoom {
  const balcony = floor.lead
  const chairX = width + (balcony ? 1.6 : OFFICE3D_WING_WIDTH / 2)
  return { x: width, y: balcony ? y + OFFICE3D_BALCONY_Y : y, balcony, chair: [chairX, 2] }
}

/** The lobby's key; no host is named so. */
export const OFFICE3D_LOBBY = '@lobby'

/** A place a figure sits or stands in the lobby, and what it faces. */
export type Office3dSpot = { at: Office3dPoint; face: Office3dPoint }

/** The lobby's furniture, by floor width, so the meshes, the seats and the tests share it. */
export type Office3dLobby = {
  counter: { x: number; z: number; w: number; d: number }
  tables: Office3dPoint[]
  cafe: Office3dSpot[]
  tv: Office3dPoint
  couch: { x: number; z: number; w: number; d: number }
  console: Office3dSpot[]
  pingpong: { x: number; z: number; w: number; d: number }
  paddles: Office3dSpot[]
  talk: Office3dSpot[]
  door: Office3dPoint
}

export function office3dLobbyOf(width: number): Office3dLobby {
  const tables: Office3dPoint[] = [
    [2, 2.4],
    [4.2, 2.4]
  ]
  // Why these spots: at the narrowest lobby the couch, the table and the talkers each keep a
  // body's width apart, so two rooms' figures never stand in one another.
  const tv = width * 0.52
  const pp = width - 1.9
  // Why up front by the aisle: further back, the walk to them crossed a cafeteria chair.
  const talk = width / 3
  return {
    counter: { x: 2.2, z: 0.45, w: 2.6, d: 0.6 },
    tables,
    // Two chairs a table, facing each other across it.
    cafe: tables.flatMap(([x, z]) => [
      { at: [x - 0.75, z] as Office3dPoint, face: [x, z] as Office3dPoint },
      { at: [x + 0.75, z] as Office3dPoint, face: [x, z] as Office3dPoint }
    ]),
    tv: [tv, 0.15],
    // Why 3.2 wide, seats 1.9 apart: closer, the camera's corner merged the two players into one.
    couch: { x: tv, z: 2.05, w: 3.2, d: 0.7 },
    console: [-0.95, 0.95].map((dx) => ({
      at: [tv + dx, 1.9] as Office3dPoint,
      face: [tv + dx, 0] as Office3dPoint
    })),
    pingpong: { x: pp, z: 2.6, w: 2.2, d: 1.2 },
    paddles: [-1.5, 1.5].map((dx) => ({
      at: [pp + dx, 2.6] as Office3dPoint,
      face: [pp, 2.6] as Office3dPoint
    })),
    talk: [0, 1.1].map((dx) => ({
      at: [talk + dx, 3.2] as Office3dPoint,
      face: [talk + 0.55, 3.2] as Office3dPoint
    })),
    door: [width - 0.8, OFFICE3D_DEPTH - 0.3]
  }
}

/**
 * The building: the shared lobby at the bottom, then the lead's floor, then each machine, as
 * `teamSceneFloorsOf` orders them. `previous` keeps every member on the desk it had.
 */
export function teamOffice3dLayoutOf(
  floors: readonly Office3dFloorInput[],
  args: { leadAdvisor: boolean; previous?: Record<string, (string | null)[]> }
): Office3dLayout {
  const order: Record<string, (string | null)[]> = {}
  const built = floors.map((floor, i): Office3dFloor => {
    // Why one up: the lobby is the ground floor, so a floor's index is its lift level.
    const y = (i + 1) * OFFICE3D_PITCH
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
  // Why under the wing too: the lead's office and the control rooms stand over the lobby's right
  // end, so the full footprint is the building's own width, and the rooms get their space.
  const width = Math.max(
    MIN_WIDTH,
    ...built.map((f) => f.width + (f.office || f.controlRoom ? OFFICE3D_WING_WIDTH : 0))
  )
  const lobby: Office3dFloor = {
    key: OFFICE3D_LOBBY,
    lobby: true,
    name: '',
    lead: false,
    reachable: true,
    y: 0,
    width,
    scale: 1,
    seats: [],
    used: 0,
    office: null,
    controlRoom: null
  }
  return { floors: [lobby, ...built], order }
}

/** Where a seat's sitter stands for the lead to talk to it: just behind the chair, in the aisle. */
// Why on the chair's left: the camera sits to the right and in front, so a lead behind or right
// of the chair was drawn over its sitter.
export const office3dStandBehind = (seat: Office3dSeat): Office3dPoint => [
  seat.x - 0.9,
  OFFICE3D_SEAT_Z + 1.25
]
