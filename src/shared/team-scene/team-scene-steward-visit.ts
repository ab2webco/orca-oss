import { TEAM_STEWARD_NAME } from '../team-panel-steward'
import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { teamSceneArrived as near } from './team-scene-motion'
import type {
  TeamSceneEvent,
  TeamSceneGesture,
  TeamSceneSpot,
  TeamSceneStewardMove
} from './team-scene-types'

// The Orca steward (ORCA-1242) is on stage only while it visits a member whose model it moved: in
// from the nearer edge, a raise or lower at the member's shoulder with its reason, then a puff.

const KEY = 'steward'
const EDGE_X = 0.04
const TELL_SECONDS = 3.2
// Why a few: moves ride a 30 s poll, so an older one waiting longer is no longer news.
const QUEUE_MAX = 3
// Why quicker than the advisor: it crosses half the stage, and the card has already changed.
const SPEED_PX = 96

type Call = { key: string; move: TeamSceneStewardMove }

export type TeamSceneStewardVisit = {
  stage: 'away' | 'walk' | 'tell'
  queue: Call[]
  call: Call | null
  at: number
}

export const createStewardVisit = (): TeamSceneStewardVisit => ({
  stage: 'away',
  queue: [],
  call: null,
  at: 0
})

export function queueStewardVisits(world: TeamSceneWorld, events: TeamSceneEvent[]): void {
  const { queue } = world.stewardVisit
  for (const event of events) {
    if (event.kind === 'stewarded') {
      queue.push({ key: event.key, move: event.move })
    }
  }
  queue.splice(0, Math.max(0, queue.length - QUEUE_MAX))
}

// Why in front, half a body aside: from the back aisle or a gap beside the desk, the member hid
// it wherever the row is tight, and how tight depends on the style's figure.
const ASIDE_PX = 18
const FRONT_DEPTH = 0.2
function shoulderOf(world: TeamSceneWorld, seat: TeamSceneSpot, width: number): TeamSceneSpot {
  const side = (world.bodies.get('lead')?.x ?? 0) > seat.x ? -1 : 1
  return { x: seat.x + (side * ASIDE_PX) / width, depth: Math.min(1, seat.depth + FRONT_DEPTH) }
}

const puff = (world: TeamSceneWorld, { x, depth }: TeamSceneSpot): void => {
  world.effects.push({ kind: 'burst', key: KEY, reason: 'puff', at: { x, depth } })
}

function leave(world: TeamSceneWorld): void {
  const body = world.bodies.get(KEY)
  if (body) {
    puff(world, body)
  }
  world.bodies.delete(KEY)
  Object.assign(world.stewardVisit, { stage: 'away', call: null })
}

/** Reduced motion: no visit shows, and none waits to. */
export function endStewardVisit(world: TeamSceneWorld): void {
  world.bodies.delete(KEY)
  world.stewardVisit = createStewardVisit()
}

export function stepStewardVisit(
  world: TeamSceneWorld,
  width: number,
  make: (spot: TeamSceneSpot) => TeamSceneBody
): void {
  const visit = world.stewardVisit
  if (visit.stage === 'away') {
    const call = visit.queue.shift()
    const seat = call && world.bodies.get(call.key)
    if (call && seat) {
      const { depth } = shoulderOf(world, seat.home, width)
      const spot = { x: seat.home.x < 0.5 ? EDGE_X : 1 - EDGE_X, depth }
      world.bodies.set(KEY, { ...make(spot), name: TEAM_STEWARD_NAME, speed: SPEED_PX })
      puff(world, spot)
      Object.assign(visit, { stage: 'walk', call })
    }
    return
  }
  const body = world.bodies.get(KEY)
  const seat = visit.call && world.bodies.get(visit.call.key)
  if (!body || !seat || seat.plan.kind === 'leave') {
    leave(world)
  } else if (visit.stage === 'walk') {
    body.target = shoulderOf(world, seat.home, width)
    // Why the depth too: stepping in front, it would speak while still behind the member.
    if (near(body, width) && Math.abs(body.depth - body.target.depth) < 0.02) {
      Object.assign(visit, { stage: 'tell', at: world.t })
    }
  } else {
    body.facing = seat.x < body.x ? -1 : 1
    if (world.t - visit.at >= TELL_SECONDS) {
      leave(world)
    }
  }
}

/** The member it stands by and its move, while it says why; null otherwise. */
export const stewardSaysOf = (world: TeamSceneWorld): Call | null =>
  world.stewardVisit.stage === 'tell' ? world.stewardVisit.call : null

export const stewardGestureOf = (world: TeamSceneWorld): TeamSceneGesture | null => {
  const said = stewardSaysOf(world)
  return said ? (said.move.lift === 'raise' ? 'raised' : 'lowered') : null
}
