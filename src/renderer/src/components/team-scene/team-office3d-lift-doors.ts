import {
  office3dCabDoorsAt,
  office3dCabFloorAt,
  type Office3dCab
} from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_CALL,
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
 * someone presses or waits for a cab that is elsewhere, and doors that open only for a rider the
 * cab stands there for: fully open before it steps in or out, shut before the cab moves.
 */
export function office3dLiftAt(
  walkers: readonly Office3dLiftWalker[],
  cab: Office3dCab,
  t: number,
  floors: number
): { lit: boolean[]; open: number[] } {
  const cabAt = office3dCabFloorAt(cab, t)
  const lit: boolean[] = []
  const open: number[] = []
  for (let fi = 0; fi < floors; fi++) {
    const here = Math.abs(cabAt - fi) < 0.05
    const on = walkers.filter((w) => onFloor(w, fi))
    lit.push(on.some((w) => w.pose === 'call' || (waiting(w) && !here)))
    // Why from the cab's bookings: opened by who stood near, they snapped open as riders walked in.
    open.push(office3dCabDoorsAt(cab, fi, t))
  }
  return { lit, open }
}
