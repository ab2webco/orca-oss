import {
  office3dCabFloorAt,
  type Office3dCab
} from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_CALL,
  OFFICE3D_DOOR_Z,
  OFFICE3D_LIFT,
  type Office3dPoint
} from '../../../../shared/team-scene/team-office3d-layout'

// Why every walker: since ORCA-1317 members make most lift trips, and the doors stayed shut and the
// panel dark for them because only the lead's position was read (review ORCA-1319, finding 1).

/** Where a walker is this frame: its floor, its spot and what it does there. */
export type Office3dLiftWalker = { floor: number; at: Office3dPoint; pose: string }

// How far along the call-panel line the waiting places reach: six places 1.2 apart.
const LINE = 1.2 * 5

const onFloor = (w: Office3dLiftWalker, fi: number) => Math.abs(w.floor - fi) < 0.05

/** In the line at a floor's call panel, waiting: the first presses, the others queue behind. */
// Why the line's own poses: the lobby's talkers stand at the line's depth (ORCA-1319, 2nd pass).
const waiting = (w: Office3dLiftWalker) =>
  (w.pose === 'idle' || w.pose === 'call') &&
  Math.abs(w.at[1] - OFFICE3D_CALL[1]) < 0.15 &&
  w.at[0] > OFFICE3D_CALL[0] - 0.15 &&
  w.at[0] < OFFICE3D_CALL[0] + LINE + 0.15

/**
 * Each floor's call light and how open its doors are (0 shut, 1 open) at `t`: a light while
 * someone presses or waits for a cab that is elsewhere, and doors that open only while the cab
 * stands at that floor and someone is at them, never while it is being called.
 */
export function office3dLiftAt(
  walkers: readonly Office3dLiftWalker[],
  cab: Office3dCab,
  t: number,
  floors: number
): { lit: boolean[]; open: number[] } {
  const cabAt = office3dCabFloorAt(cab, t)
  // Why stopped: passing a floor it does not serve, the cab would flick its doors.
  const stopped =
    Math.abs(office3dCabFloorAt(cab, t + 0.05) - office3dCabFloorAt(cab, t - 0.05)) < 1e-3
  const lit: boolean[] = []
  const open: number[] = []
  for (let fi = 0; fi < floors; fi++) {
    const here = Math.abs(cabAt - fi) < 0.05
    const on = walkers.filter((w) => onFloor(w, fi))
    lit.push(on.some((w) => w.pose === 'call' || (waiting(w) && !here)))
    const nearest = on
      .filter((w) => w.pose !== 'call')
      .map((w) => Math.hypot(w.at[0] - OFFICE3D_LIFT[0] / 2, w.at[1] - OFFICE3D_DOOR_Z))
    const near = Math.min(Infinity, ...nearest)
    open.push(here && stopped ? Math.min(1, Math.max(0, (1.9 - near) / 0.6)) : 0)
  }
  return { lit, open }
}
