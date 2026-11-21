import {
  OFFICE3D_SEAT_Z,
  OFFICE3D_WING_WIDTH,
  office3dLobbyOf,
  type Office3dLayout,
  type Office3dPoint
} from './team-office3d-layout'
import type { Office3dWalkPose } from './team-office3d-walkers'

// Why each seat carries its way in: a figure leaves by the way it came, so it never cuts through
// the chair back, the couch or a table it walked around (ORCA-1317).

/** Where a member can be: its desk, a guest chair in the lead's office, or a lobby spot. */
export type Office3dSlotKind = 'desk' | 'guest' | 'cafe' | 'console' | 'paddle' | 'talk'

/** A slot: reached from the aisle at `entry`, then along `path` (ending at `at`). */
export type Office3dSlot = {
  kind: Office3dSlotKind
  index: number
  floor: number
  at: Office3dPoint
  face: Office3dPoint
  entry: number
  path: Office3dPoint[]
}

const SEAT_PITCH = 2.2

/** A slot's identity across reads: slots are rebuilt from the layout on every read. */
export const office3dSlotId = (s: Office3dSlot | null): string =>
  s ? `${s.kind}:${s.floor}:${s.index}:${s.at[0].toFixed(2)},${s.at[1].toFixed(2)}` : 'none'

export const office3dSeatPose = (kind: Office3dSlotKind): Exclude<Office3dWalkPose, 'walk'> =>
  kind === 'desk' ? 'desk' : kind === 'paddle' || kind === 'talk' ? 'stand' : 'sit'

/** Every slot in the building: each member's desk, the guest chairs, the lobby's places. */
export function office3dSlotsOf(layout: Office3dLayout): {
  desks: Map<string, Office3dSlot>
  guest: Office3dSlot[]
  cafe: Office3dSlot[]
  games: Office3dSlot[]
} {
  const desks = new Map<string, Office3dSlot>()
  const guest: Office3dSlot[] = []
  let lobbyWidth = 0
  for (const [floor, f] of layout.floors.entries()) {
    if (f.lobby) {
      lobbyWidth = f.width
      continue
    }
    for (const seat of f.seats) {
      if (seat.key === null) {
        continue
      }
      const z = OFFICE3D_SEAT_Z + 0.08 * f.scale
      // Why down beside the chair, then into it: straight in from behind, it crossed the back.
      const side = seat.x - (SEAT_PITCH * f.scale) / 2 + 0.1
      desks.set(seat.key, {
        kind: 'desk',
        index: 0,
        floor,
        at: [seat.x, z],
        face: [seat.x, 0],
        entry: side,
        path: [
          [side, z],
          [seat.x, z]
        ]
      })
    }
    if (f.office) {
      const ox = f.office.x
      const desk: Office3dPoint = [ox + OFFICE3D_WING_WIDTH / 2, 2.6]
      for (const [i, gx] of [desk[0] - 0.65, desk[0] + 0.65].entries()) {
        guest.push({
          kind: 'guest',
          index: i,
          floor,
          at: [gx, 3.85],
          face: desk,
          entry: ox + 0.6,
          // In through the office's glass door, in front of both chairs, then down into one.
          path: [
            [ox + 0.6, 4.6],
            [gx, 4.6],
            [gx, 3.85]
          ]
        })
      }
    }
  }
  const L = office3dLobbyOf(lobbyWidth)
  const straight =
    (kind: Office3dSlotKind) => (s: { at: Office3dPoint; face: Office3dPoint }, i: number) =>
      ({
        kind,
        index: i,
        floor: 0,
        at: s.at,
        face: s.face,
        entry: s.at[0],
        path: [s.at]
      }) as Office3dSlot
  const cafe = L.cafe.map(straight('cafe'))
  const tvX = L.tv[0]
  // Between the TV and the couch, then back onto the couch: over its back would be through it.
  const consoles = L.console.map(
    (s, i): Office3dSlot => ({
      kind: 'console',
      index: i,
      floor: 0,
      at: s.at,
      face: s.face,
      entry: tvX - 2,
      path: [[tvX - 2, 1.25], [s.at[0], 1.25], s.at]
    })
  )
  const games = [...consoles, ...L.paddles.map(straight('paddle')), ...L.talk.map(straight('talk'))]
  return { desks, guest, cafe, games }
}
