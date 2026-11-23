import { dioramaPaceOf } from './team-diorama-lead-round'
import { polyLengths } from './team-diorama-nav'
import { bookOffice3dCab, type Office3dCab } from './team-office3d-elevator'
import {
  OFFICE3D_CALL,
  OFFICE3D_CALL_PANEL,
  OFFICE3D_LIFT,
  type Office3dPoint
} from './team-office3d-layout'
import {
  OFFICE3D_EXIT,
  OFFICE3D_JUMP,
  OFFICE3D_PRESS,
  OFFICE3D_WALK,
  type Office3dStep,
  type Office3dWalkPose
} from './team-office3d-walkers'

const CAB_CAPACITY = 3

/** The building's call-panel lines, per floor: when each one waiting there will have boarded. */
export type Office3dQueue = Map<number, number[]>

/**
 * A place in the line at `floor`'s call panel for someone arriving at `t`: 0 presses the panel,
 * the next stand behind it. Members and the lead share one line, so nobody stands in another.
 */
export const office3dQueued =
  (queue: Office3dQueue) =>
  (floor: number, t: number): number => {
    // Why held 12 s and up to 6 places: a shorter hold or a cap let two stand on one spot.
    const waits = (queue.get(floor) ?? []).filter((until) => until > t)
    queue.set(floor, [...waits, t + 12])
    return Math.min(waits.length, 5)
  }
// Why two lanes: members walking opposite ways pass each other instead of through each other.
export const office3dLaneOf = (fromX: number, toX: number): number => (toX >= fromX ? 3.8 : 4.4)

/** How far along `s` the point `p` lies, by its nearest segment. */
export function office3dPolyLengthTo(
  s: { pts: Office3dPoint[]; cum: number[] },
  p: Office3dPoint
): number {
  let best = { d: Infinity, along: 0 }
  for (let i = 1; i < s.pts.length; i++) {
    const [a, b] = [s.pts[i - 1]!, s.pts[i]!]
    const len = s.cum[i]! - s.cum[i - 1]!
    const k =
      len > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len)
            )
          )
        : 0
    const q = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    const d = Math.hypot(p[0] - q[0]!, p[1] - q[1]!)
    if (d < best.d) {
      best = { d, along: s.cum[i - 1]! + k * len }
    }
  }
  return best.along
}

/** Plans walks, the lift and holds from `start`, for one figure, on the building's clock. */
export function office3dPlanner(
  start: number,
  floor: number,
  at: Office3dPoint,
  pace: string | undefined
) {
  const { speed, jump } = dioramaPaceOf(pace)
  const steps: Office3dStep[] = []
  let t = start
  let here = at
  let level = floor
  const push = (s: Office3dStep) => {
    steps.push(s)
    t += s.dur
  }
  const walk = (...to: Office3dPoint[]) => {
    const pts = [here, ...to]
    const cum = polyLengths(pts)
    if (cum.at(-1)! < 1e-6) {
      return
    }
    push({
      kind: 'walk',
      floor: level,
      pts,
      cum,
      start: t,
      dur: Math.max(0.2, cum.at(-1)! / (OFFICE3D_WALK * speed))
    })
    here = to.at(-1)!
  }
  const hold = (pose: Exclude<Office3dWalkPose, 'walk'>, dur: number, face: Office3dPoint | null) =>
    push({ kind: 'hold', floor: level, at: here, pose, face, start: t, dur: Math.max(0, dur) })
  return {
    steps,
    jump,
    speed,
    get t() {
      return t
    },
    get here() {
      return here
    },
    get level() {
      return level
    },
    walk,
    hold,
    push,
    jumpTo: (toFloor: number, to: Office3dPoint) => {
      push({
        kind: 'jump',
        from: { floor: level, at: here },
        to: { floor: toFloor, at: to },
        start: t,
        dur: OFFICE3D_JUMP
      })
      level = toFloor
      here = to
    },
    ride: (toFloor: number, cab: Office3dCab, queued: number) => {
      // In line at the call panel: the first presses, the next wait behind it, in order.
      const spot: Office3dPoint = [OFFICE3D_CALL[0] + 1.2 * queued, OFFICE3D_CALL[1]]
      walk(
        [here[0], office3dLaneOf(here[0], spot[0])],
        [spot[0], office3dLaneOf(here[0], spot[0])],
        spot
      )
      hold(queued === 0 ? 'call' : 'idle', OFFICE3D_PRESS / speed, OFFICE3D_CALL_PANEL)
      // Why to the far spot: whichever spot it gets, the doors must not shut while it walks in.
      const walkIn = Math.max(
        0.2,
        Math.hypot(spot[0] - OFFICE3D_LIFT[0] + 0.45, spot[1] - OFFICE3D_LIFT[1]) /
          (OFFICE3D_WALK * speed)
      )
      const booked = bookOffice3dCab(cab, level, toFloor, t, speed, CAB_CAPACITY, walkIn)
      // It waits at the panel until the cab is here and its doors are fully open (ORCA-1374).
      hold('idle', booked.board - t, OFFICE3D_CALL_PANEL)
      // Riders stand side by side in the cab, never in one another.
      const inCab: Office3dPoint = [OFFICE3D_LIFT[0] + (booked.seat - 1) * 0.45, OFFICE3D_LIFT[1]]
      walk(inCab)
      hold('idle', booked.depart - t, null)
      push({ kind: 'ride', start: t, dur: booked.arrive - t, at: inCab })
      level = toFloor
      hold('idle', booked.out - t, null)
      walk(OFFICE3D_EXIT)
    }
  }
}
