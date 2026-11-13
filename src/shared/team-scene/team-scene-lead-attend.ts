import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import type { TeamSceneSpot } from './team-scene-types'

// Why px: sprites keep their size at any stage width; the lead's body and a face are each ~18 px.
const CLEAR_PX = 20
const LEAD_HALF_PX = 9
const IN_FRONT = 0.04
// Why behind: with no room beside, the asker is drawn over the lead, so its face stays whole.
const BEHIND = 0.06
// Why: an asker's name tag is about 44 px wide over its head, and the lead's head is 18.
const TAG_CLEAR_PX = 32

/**
 * Where the lead stands to attend `member`: beside it, on the side toward the lead's home first, clear
 * of every face it is drawn over; else just behind it, between it and its neighbour (ORCA-1190).
 */
export function teamSceneAttendSpotOf(
  world: TeamSceneWorld,
  member: TeamSceneBody,
  width: number,
  toward: 1 | -1
): TeamSceneSpot {
  const { home } = member
  const clear = CLEAR_PX / width
  const others = [...world.bodies.values()].filter((b) => b.role === 'member' && b !== member)
  const fits = (x: number, depth: number): boolean =>
    x * width - LEAD_HALF_PX >= 0 &&
    x * width + LEAD_HALF_PX <= width &&
    others.every((b) => b.home.depth >= depth || Math.abs(x - b.home.x) * width >= CLEAR_PX)
  for (const side of [toward, -toward]) {
    const x = home.x + side * clear
    if (fits(x, home.depth + IN_FRONT)) {
      return { x, depth: home.depth + IN_FRONT }
    }
  }
  // Why halfway at most: past it the lead stands behind the next seat, two to one desk.
  // Why its own row: another row's desk is not one the lead would stand on.
  const next = world.stations
    .filter((s) => Math.abs(s.depth - home.depth) < 0.001)
    .map((s) => (s.x - home.x) * toward)
    .filter((d) => d > 0.001)
  const x = Math.min(
    Math.max(home.x + toward * Math.min(clear, ...next.map((d) => d / 2)), LEAD_HALF_PX / width),
    1 - LEAD_HALF_PX / width
  )
  if (fits(x, home.depth - BEHIND)) {
    return { x, depth: home.depth - BEHIND }
  }
  // Why the back row last: behind a front-row asker the lead still stands over the back row's faces;
  // that high, its head reaches the asker's name tag, so it stands a tag's width aside.
  const back = Math.min(...others.map((b) => b.home.depth), home.depth) - BEHIND
  const aside = [toward, -toward]
    .map((side) => home.x + (side * TAG_CLEAR_PX) / width)
    .find((at) => at * width - LEAD_HALF_PX >= 0 && at * width + LEAD_HALF_PX <= width)
  return { x: aside ?? x, depth: back }
}
