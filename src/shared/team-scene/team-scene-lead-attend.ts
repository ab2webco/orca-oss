import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import type { TeamSceneSpot } from './team-scene-types'

/** What a style tells the lead about attending: how far its reach goes and where an asker's mark hangs. */
export type TeamSceneAttendReach = {
  /** Px an attending lead keeps from any face or mark it is drawn over (ORCA-1190). */
  attendReachPx?: number
  /** Px from a member's x to the mark it raises; 0 when the mark hangs over its head. */
  attendMarkDxPx?: number
}

// Why 26: in the captures a ground lead's raised sword crosses a face 20 px away, not 26.
const GROUND_REACH_PX = 26
const LEAD_HALF_PX = 9
const IN_FRONT = 0.04
const BESIDE_X = 0.075

/**
 * Where the lead stands to attend `member`: in front of the row, at the nearest x its reach clears
 * every face and mark it is drawn over, never closer than main's spot, inside the stage (ORCA-1190).
 */
export function teamSceneAttendSpotOf(
  world: TeamSceneWorld,
  member: TeamSceneBody,
  width: number,
  toward: 1 | -1
): TeamSceneSpot {
  const { home } = member
  const depth = home.depth + IN_FRONT
  const reach = world.layout.attendReachPx ?? GROUND_REACH_PX
  const markDx = world.layout.attendMarkDxPx ?? 0
  const at = home.x * width
  // Why main's spot: beside the asker, halfway to the next seat at most, as main had it.
  const next = world.stations.map((s) => (s.x - home.x) * width * toward).filter((d) => d > 0.1)
  const main = Math.min(BESIDE_X * width, ...next.map((d) => d / 2))
  const members = [...world.bodies.values()].filter((b) => b.role === 'member')
  const avoid = [
    ...members.filter((b) => b !== member && b.home.depth < depth).map((b) => b.home.x * width),
    ...members.filter((b) => b.activity === 'needsYou').map((b) => b.home.x * width + markDx)
  ]
  const fits = (px: number): boolean =>
    px - LEAD_HALF_PX >= 0 &&
    px + LEAD_HALF_PX <= width &&
    Math.abs(px - at) >= reach &&
    avoid.every((x) => Math.abs(px - x) >= reach)
  for (let d = Math.max(reach, main); d <= width; d++) {
    for (const side of [toward, -toward]) {
      if (fits(at + side * d)) {
        return { x: (at + side * d) / width, depth }
      }
    }
  }
  return { x: (at + toward * main) / width, depth }
}
