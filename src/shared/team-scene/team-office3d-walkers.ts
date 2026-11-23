import { dioramaPaceOf } from './team-diorama-lead-round'
import { polyAt, polyLengths } from './team-diorama-nav'
import {
  bookOffice3dCab,
  office3dCab,
  office3dCabBusyFor,
  office3dCabFloorAt,
  type Office3dCab
} from './team-office3d-elevator'
import {
  OFFICE3D_AISLE_Z,
  OFFICE3D_CALL,
  OFFICE3D_CALL_PANEL,
  OFFICE3D_DOOR_Z,
  OFFICE3D_LIFT,
  OFFICE3D_SEAT_Z,
  OFFICE3D_WING_WIDTH,
  office3dStandBehind,
  type Office3dLayout,
  type Office3dPoint
} from './team-office3d-layout'

// Why a plan, as the diorama's round: laid out once per read of the team, so any moment is a lookup.
// Each floor's advisor never walks: it sits in its own control room, so only the lead rides the lift.

/** `call`: pressing the lift's call button, which lights while it does. */
/** `sit` and `stand`: a member in a room or the lead's office; `gone`: out of the building. */
export type Office3dWalkPose =
  | 'walk'
  | 'talk'
  | 'give'
  | 'idle'
  | 'desk'
  | 'call'
  | 'sit'
  | 'stand'
  | 'gone'

/** `floor` is an index into the layout's floors; a ride's height comes from the cab. */
export type Office3dStep =
  | { kind: 'walk'; floor: number; pts: Office3dPoint[]; cum: number[]; start: number; dur: number }
  | {
      kind: 'hold'
      floor: number
      at: Office3dPoint
      pose: Exclude<Office3dWalkPose, 'walk'>
      face: Office3dPoint | null
      start: number
      dur: number
    }
  /** `at` is the rider's own spot in the cab; riders stand side by side, never in one another. */
  | { kind: 'ride'; start: number; dur: number; at?: Office3dPoint }
  | {
      kind: 'jump'
      from: { floor: number; at: Office3dPoint }
      to: { floor: number; at: Office3dPoint }
      start: number
      dur: number
    }

export type Office3dRound = { steps: Office3dStep[]; total: number; cab: Office3dCab }

/** Walking speed, the call press, and a Direct jump: one pace for every figure in the building. */
export const OFFICE3D_WALK = 1.9
const WALK = OFFICE3D_WALK
const TALK = 3.4
export const OFFICE3D_PRESS = 0.6
const PRESS = OFFICE3D_PRESS
const GIVE = 1.1
export const OFFICE3D_JUMP = 1.6
const JUMP = OFFICE3D_JUMP
const HOME_PAUSE = 4.5
/** Just outside each floor's lift door, where riders step out. */
export const OFFICE3D_EXIT: Office3dPoint = [0.9, OFFICE3D_DOOR_Z]
const DOOR = OFFICE3D_EXIT

/** The lead's desk in its office, and the way out of the office to the aisle. */
const homeOf = (office: { x: number }): Office3dPoint => [office.x + OFFICE3D_WING_WIDTH / 2, 1.65]
const officeDoorOf = (office: { x: number }): Office3dPoint => [office.x + 0.6, OFFICE3D_AISLE_Z]
// Why round the desk's left side: a straight line from the chair to the door went through the desk.
const besideDeskOf = (office: { x: number }): Office3dPoint => [office.x + 0.6, 1.65]

/**
 * One trip of the lead from its desk, starting at `start`: a talk with each member in `needs` (one
 * lift trip per floor, in order), then a folder handed to each in `visits`, then back to its desk.
 * Only events fill these (ORCA-1317): with none it just sits. An unreachable floor gets no visit,
 * and Direct swaps every walk and ride for a jump. `cab` is the building's one lift, shared.
 */
export function office3dLeadRoundOf(args: {
  layout: Office3dLayout
  needs: readonly string[]
  visits: readonly string[]
  pace: string | undefined
  start?: number
  cab?: Office3dCab
  /** Its place in the call-panel line it shares with the members; alone it presses at once. */
  queued?: (floor: number, t: number) => number
  /** Where it sets out from when not at its desk. */
  from?: { floor: number; at: Office3dPoint }
}): Office3dRound {
  const { speed, holdScale, jump } = dioramaPaceOf(args.pace)
  const floors = args.layout.floors
  const leadFloor = Math.max(
    0,
    floors.findIndex((f) => f.lead)
  )
  const office = floors[leadFloor]?.office ?? { x: floors[leadFloor]?.width ?? 0 }
  const home = homeOf(office)
  const cab = args.cab ?? office3dCab(leadFloor)
  const steps: Office3dStep[] = []
  let t = args.start ?? 0
  let floor = leadFloor
  let here = home
  const push = (step: Office3dStep) => {
    steps.push(step)
    t += step.dur
  }
  if (args.from) {
    ;({ floor, at: here } = args.from)
  }
  const walk = (...to: Office3dPoint[]) => {
    const pts = [here, ...to]
    const cum = polyLengths(pts)
    push({
      kind: 'walk',
      floor,
      pts,
      cum,
      start: t,
      dur: Math.max(0.2, cum.at(-1)! / (WALK * speed))
    })
    here = to.at(-1)!
  }
  const hold = (pose: Exclude<Office3dWalkPose, 'walk'>, dur: number, face: Office3dPoint | null) =>
    push({ kind: 'hold', floor, at: here, pose, face, start: t, dur })
  const goTo = (toFloor: number, stand: Office3dPoint) => {
    if (jump) {
      push({
        kind: 'jump',
        from: { floor, at: here },
        to: { floor: toFloor, at: stand },
        start: t,
        dur: JUMP
      })
      floor = toFloor
      here = stand
      return
    }
    const fromDesk = floor === leadFloor && here === home
    if (toFloor !== floor) {
      // Why stay put: while the cab serves riders booked first, the lead stood frozen at its door
      // (ORCA-1336); it keeps working, or talking, and sets out to press the call as the cab frees.
      const toPanel = polyLengths([
        here,
        ...(fromDesk ? [besideDeskOf(office), officeDoorOf(office)] : []),
        [fromDesk ? officeDoorOf(office)[0] : here[0], OFFICE3D_AISLE_Z],
        [1.2, OFFICE3D_AISLE_Z],
        OFFICE3D_CALL
      ]).at(-1)!
      const ready = t + toPanel / (WALK * speed) + PRESS / speed
      const busy = office3dCabBusyFor(cab, floor, toFloor, ready, speed)
      if (busy > 0) {
        const last = steps.findLast((s) => s.kind === 'hold')
        hold(
          fromDesk ? 'desk' : 'talk',
          busy,
          !fromDesk && last?.kind === 'hold' ? last.face : null
        )
      }
    }
    if (fromDesk) {
      walk(besideDeskOf(office), officeDoorOf(office))
    }
    if (toFloor !== floor) {
      // Its place in the line: the first presses the panel, the next wait behind, never in one.
      const place = args.queued?.(floor, t) ?? 0
      const spot: Office3dPoint = [OFFICE3D_CALL[0] + 1.2 * place, OFFICE3D_CALL[1]]
      walk([here[0], OFFICE3D_AISLE_Z], [1.2 + 1.2 * place, OFFICE3D_AISLE_Z], spot)
      // Why its walk in is booked: the doors must not shut while it is still stepping in.
      const walkIn = Math.max(
        0.2,
        Math.hypot(spot[0] - OFFICE3D_LIFT[0], spot[1] - OFFICE3D_LIFT[1]) / (WALK * speed)
      )
      // It presses the call button first; the cab answers only once it has.
      hold(place === 0 ? 'call' : 'idle', PRESS / speed, OFFICE3D_CALL_PANEL)
      const booked = bookOffice3dCab(cab, floor, toFloor, t, speed, 1, walkIn)
      // It waits at the panel until the cab is here and its doors are fully open (ORCA-1374).
      hold('idle', booked.board - t, OFFICE3D_CALL_PANEL)
      walk(OFFICE3D_LIFT)
      hold('idle', booked.depart - t, null)
      push({ kind: 'ride', start: t, dur: booked.arrive - t })
      floor = toFloor
      hold('idle', booked.out - t, null)
      walk(DOOR)
    }
    walk([here[0], OFFICE3D_AISLE_Z], [stand[0], OFFICE3D_AISLE_Z], stand)
  }

  const placeOf = (key: string): { floor: number; stand: Office3dPoint } | null => {
    for (const [i, f] of floors.entries()) {
      const seat = f.seats.find((s) => s.key === key)
      if (seat) {
        return f.reachable ? { floor: i, stand: office3dStandBehind(seat) } : null
      }
    }
    return null
  }
  // Why grouped: one lift trip per floor, floors in the order their first asker comes.
  const trips = new Map<number, Office3dPoint[]>()
  for (const key of args.needs) {
    const place = placeOf(key)
    if (place) {
      trips.set(place.floor, [...(trips.get(place.floor) ?? []), place.stand])
    }
  }
  for (const [toFloor, stands] of trips) {
    for (const stand of stands) {
      goTo(toFloor, stand)
      hold('talk', TALK * holdScale, [stand[0] + 0.9, OFFICE3D_SEAT_Z])
    }
  }
  for (const key of args.visits) {
    const place = placeOf(key)
    if (place && !args.needs.includes(key)) {
      goTo(place.floor, place.stand)
      hold('give', GIVE * holdScale, [place.stand[0] + 0.9, OFFICE3D_SEAT_Z])
    }
  }
  if (floor !== leadFloor || here !== home) {
    if (jump) {
      push({
        kind: 'jump',
        from: { floor, at: here },
        to: { floor: leadFloor, at: home },
        start: t,
        dur: JUMP
      })
      floor = leadFloor
      here = home
    } else {
      goTo(leadFloor, officeDoorOf(office))
      walk(besideDeskOf(office), home)
    }
  }
  hold('desk', HOME_PAUSE * holdScale, null)
  return { steps, total: t, cab }
}

const ease = (x: number): number => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/** Where a walker is at `t` into its round, looping: floor (fractional while riding), spot, pose. */
export function office3dWalkerAt(
  round: Office3dRound,
  t: number
): {
  floor: number
  at: Office3dPoint
  heading: Office3dPoint | null
  pose: Office3dWalkPose
  blink: number
} {
  // Why a non-finite total plays once: the traffic's plans run on the clock and never loop.
  const tt = !Number.isFinite(round.total)
    ? t
    : round.total > 0
      ? ((t % round.total) + round.total) % round.total
      : 0
  const s = round.steps.find((x) => tt >= x.start && tt < x.start + x.dur) ?? round.steps.at(-1)
  if (!s) {
    return { floor: round.cab.home, at: [0, 0], heading: null, pose: 'idle', blink: 1 }
  }
  const k = s.dur > 0 ? (tt - s.start) / s.dur : 1
  if (s.kind === 'walk') {
    const p = polyAt(s.pts, s.cum, ease(k) * s.cum.at(-1)!)
    return { floor: s.floor, at: p.at, heading: p.heading, pose: 'walk', blink: 1 }
  }
  if (s.kind === 'ride') {
    return {
      floor: office3dCabFloorAt(round.cab, tt),
      at: s.at ?? OFFICE3D_LIFT,
      heading: [1, 0],
      pose: 'idle',
      blink: 1
    }
  }
  if (s.kind === 'jump') {
    const end = k < 0.5 ? s.from : s.to
    return {
      floor: end.floor,
      at: end.at,
      heading: null,
      pose: 'idle',
      blink: Math.max(0.02, Math.abs(1 - 2 * k))
    }
  }
  const heading: Office3dPoint | null = s.face ? [s.face[0] - s.at[0], s.face[1] - s.at[1]] : null
  return { floor: s.floor, at: s.at, heading, pose: s.pose, blink: 1 }
}

/**
 * A member coming to its desk (`arriving`) or going from it: through its own floor's lift door,
 * not the cab, so a newcomer never waits behind the lead's round. Direct is a blink at the desk.
 */
export function office3dCommuteOf(args: {
  layout: Office3dLayout
  key: string
  arriving: boolean
  pace: string | undefined
}): Office3dRound | null {
  const { speed, jump } = dioramaPaceOf(args.pace)
  const floor = args.layout.floors.findIndex((f) => f.seats.some((s) => s.key === args.key))
  const seat = args.layout.floors[floor]?.seats.find((s) => s.key === args.key)
  if (!seat) {
    return null
  }
  const desk: Office3dPoint = [seat.x, office3dStandBehind(seat)[1] - 0.35]
  const cab = office3dCab(floor)
  if (jump) {
    const at = { floor, at: desk }
    return {
      steps: [{ kind: 'jump', from: at, to: at, start: 0, dur: JUMP / 2 }],
      total: JUMP / 2,
      cab
    }
  }
  const route: Office3dPoint[] = [
    OFFICE3D_LIFT,
    DOOR,
    [1.3, OFFICE3D_AISLE_Z],
    [seat.x, OFFICE3D_AISLE_Z],
    desk
  ]
  const pts = args.arriving ? route : route.toReversed()
  const cum = polyLengths(pts)
  const dur = cum.at(-1)! / (WALK * speed)
  return { steps: [{ kind: 'walk', floor, pts, cum, start: 0, dur }], total: dur, cab }
}
