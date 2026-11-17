import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { teamSceneArrived as near } from './team-scene-motion'
import { ELEVATOR_X, stepAdvisorLeaving } from './team-scene-elevator'
import { LEAD_SPOT } from './team-scene-lead-rounds'
import type {
  TeamSceneGesture,
  TeamSceneInput,
  TeamSceneSpot,
  TeamSceneVerdictTone
} from './team-scene-types'

// Why left of the lead: its bubble hangs leftward, leaving the column above the lead free.
export const ADVISOR_SPOT: TeamSceneSpot = { x: 0.74, depth: 0.15 }
// Why px: at a narrow panel a tenth of the stage is less than a body, and Jev stood on the lead.
const LEAD_CLEAR_PX = 34
// Its idle: look over the desks, step toward them, back, glance at the board (ORCA-1218).
const IDLE_SECONDS = 2.6
const PACE_PX = 10
const THROW_RAISE_SECONDS = 0.8

// How long the advisor holds a gesture beside the pane Jev judged.
const GESTURE_SECONDS = 2.4
// Why a few: decisions ride a 30 s poll, so an older one waiting longer is no longer news.
const QUEUE_MAX = 3
// Half a gap beside a member with no neighbour on that side, and the room it leaves the lead.
const BESIDE_X = 0.06
const EDGE_X = 0.1
// Why: the advisor's whole body stays on the stage, however close a desk sits to its edge.
const STAGE_MIN_X = 0.04
const STAGE_MAX_X = 0.96
const LEAD_GAP = 0.09
// Depths closer than this share an aisle, where the advisor keeps a body width from the lead.
const AISLE = 0.2
const BODY = 0.06
const SETTLED = 0.02

/**
 * The advisor's own walks to the panes Jev judges, apart from the lead's queue of visits: along
 * the back aisle behind the row, a step forward into the gap at the judged pane, a gesture there,
 * then a puff home.
 */
export type TeamSceneAdvisorWalk = {
  stage: 'home' | 'aisle' | 'step' | 'gesture'
  queue: { key: string; gesture: TeamSceneGesture }[]
  key: string | null
  gesture: TeamSceneGesture | null
  at: number
}

export const createAdvisorWalk = (): TeamSceneAdvisorWalk => ({
  stage: 'home',
  queue: [],
  key: null,
  gesture: null,
  at: 0
})

/** Jev's home at this width: its spot, or further left, a body clear of the lead's. */
export const advisorHomeAt = (width: number): TeamSceneSpot => ({
  x: Math.min(ADVISOR_SPOT.x, LEAD_SPOT.x - LEAD_CLEAR_PX / Math.max(1, width)),
  depth: ADVISOR_SPOT.depth
})

/**
 * Sends Jev's decision to the judged member's desk at once, as the advisor raises its hand toward
 * it: its walk over takes seconds, and the owner saw a Jev that never moved (ORCA-1218).
 */
export function throwVerdict(world: TeamSceneWorld, key: string, tone: TeamSceneVerdictTone): void {
  const advisor = world.bodies.get('advisor')
  const target = world.bodies.get(key)
  if (!advisor || advisor.hidden || !target || target.role !== 'member') {
    return
  }
  world.effects.push({ kind: 'verdict', to: key, tone })
  world.advisorRaiseUntil = Math.max(world.advisorRaiseUntil, world.t + THROW_RAISE_SECONDS)
  if (world.advisorWalk.stage === 'home') {
    advisor.facing = target.x < advisor.x ? -1 : 1
  }
}

// Where an idle advisor stands this beat, and which way it looks once there.
function idleBeatOf(world: TeamSceneWorld, advisor: TeamSceneBody, width: number) {
  const beat = Math.floor(world.t / IDLE_SECONDS) % 4
  const x = beat === 1 ? advisor.home.x - PACE_PX / Math.max(1, width) : advisor.home.x
  return {
    spot: { x, depth: advisor.home.depth },
    facing: beat === 3 ? (1 as const) : (-1 as const)
  }
}

export function queueJudgment(world: TeamSceneWorld, key: string, gesture: TeamSceneGesture): void {
  if (!world.bodies.has('advisor')) {
    return
  }
  const { queue } = world.advisorWalk
  queue.push({ key, gesture })
  queue.splice(0, Math.max(0, queue.length - QUEUE_MAX))
}

// Why the gap away from the lead, behind the row: at the same member the lead would hide the
// gesture, and a gap has no monitor, so the advisor shows there while the desks part it from
// the lead in front.
function spotOf(world: TeamSceneWorld, key: string, target: TeamSceneBody): TeamSceneSpot {
  const lead = world.bodies.get('lead')
  if (key === 'lead') {
    return { x: target.x - LEAD_GAP, depth: target.depth }
  }
  const seat = target.home
  const side = lead && lead.x > seat.x ? -1 : 1
  const next = world.stations.map((s) => (s.x - seat.x) * side).filter((d) => d > 0.001)
  // Why wider at the row's end: a sitter's mark hangs just past its monitor, where the gap is.
  const half = next.length > 0 ? Math.min(BESIDE_X, ...next.map((d) => d / 2)) : EDGE_X
  const x = Math.min(STAGE_MAX_X, Math.max(STAGE_MIN_X, seat.x + side * half))
  return { x, depth: world.bodies.get('advisor')!.home.depth }
}

const MOVING_PX = 3

const isWalking = (body: TeamSceneBody): boolean => Math.abs(body.v) > MOVING_PX

// Why keep its side: walking beside or through the lead reads as one blob of two people. Only a
// lead standing still may be passed, and only behind the row, where the desks part the two.
function clearOfLead(world: TeamSceneWorld, advisor: TeamSceneBody, x: number): number {
  const lead = world.bodies.get('lead')
  if (!lead || (!isWalking(lead) && Math.abs(advisor.depth - lead.depth) >= AISLE)) {
    return x
  }
  const side = advisor.x >= lead.x ? 1 : -1
  return side > 0 ? Math.max(x, lead.x + BODY) : Math.min(x, lead.x - BODY)
}

// Why wait at home: setting out beside a walking lead, at its speed, never opens the gap.
const isLeadPassing = (world: TeamSceneWorld, advisor: TeamSceneBody): boolean => {
  const lead = world.bodies.get('lead')
  return Boolean(lead && isWalking(lead) && Math.abs(lead.x - advisor.x) < 2 * BODY)
}

function puffHome(world: TeamSceneWorld, advisor: TeamSceneBody): void {
  world.effects.push({
    kind: 'burst',
    key: 'advisor',
    reason: 'puff',
    at: { x: advisor.x, depth: advisor.depth }
  })
  Object.assign(advisor, { x: advisor.home.x, depth: advisor.home.depth, v: 0, facing: -1 })
  advisor.target = advisor.home
  world.effects.push({ kind: 'burst', key: 'advisor', reason: 'puff', at: advisor.home })
  Object.assign(world.advisorWalk, { stage: 'home', key: null, gesture: null })
}

/** One step of the advisor's walk out to a judged pane and its gesture there. */
export function stepAdvisorWalk(world: TeamSceneWorld, width: number): void {
  const advisor = world.bodies.get('advisor')
  const walk = world.advisorWalk
  if (!advisor || stepAdvisorLeaving(world)) {
    Object.assign(walk, createAdvisorWalk())
    return
  }
  const target = walk.key ? world.bodies.get(walk.key) : undefined
  if (walk.stage === 'home') {
    const home = advisorHomeAt(width)
    // Why carried, not walked: a new width moves the stage under it, and a walk crossed the lead;
    // one just out of the elevator walks home as before.
    if (Math.abs(advisor.x - advisor.home.x) * width <= PACE_PX + 2) {
      advisor.x += home.x - advisor.home.x
    }
    advisor.home = home
    const idle = idleBeatOf(world, advisor, width)
    advisor.target = idle.spot
    if (near(advisor, width) && world.t >= world.advisorRaiseUntil) {
      advisor.facing = idle.facing
    }
    const ready = near(advisor, width) && !isLeadPassing(world, advisor)
    const next = ready ? walk.queue.shift() : undefined
    if (next && world.bodies.has(next.key)) {
      Object.assign(walk, { stage: 'aisle', key: next.key, gesture: next.gesture })
    }
    return
  }
  if (!target) {
    puffHome(world, advisor)
    return
  }
  const spot = spotOf(world, walk.key!, target)
  if (walk.stage === 'aisle') {
    const x = clearOfLead(world, advisor, spot.x)
    advisor.target = { x, depth: advisor.home.depth }
    if (x === spot.x && near(advisor, width)) {
      walk.stage = 'step'
    }
  } else if (walk.stage === 'step') {
    advisor.target = spot
    if (Math.abs(advisor.depth - spot.depth) < SETTLED) {
      Object.assign(walk, { stage: 'gesture', at: world.t })
    }
  } else {
    advisor.facing = target.x < advisor.x ? -1 : 1
    if (world.t - walk.at >= GESTURE_SECONDS) {
      puffHome(world, advisor)
    }
  }
}

/** The gesture the advisor holds up this frame, for styles to draw beside it. */
export const advisorGestureOf = (world: TeamSceneWorld): TeamSceneGesture | null =>
  world.advisorWalk.stage === 'gesture' ? world.advisorWalk.gesture : null

// Why quicker than the team: a referee hurries over, so a ruling never waits on a long walk.
const ADVISOR_SPEED_PX = 48

/** Keeps the advisor's body while the scene has an advisor, at its own quicker pace. */
export function syncAdvisorBody(
  world: TeamSceneWorld,
  input: Pick<TeamSceneInput, 'advisor' | 'advisorEnters' | 'advisorLeaves'>,
  make: () => TeamSceneBody
): void {
  if (input.advisor === null) {
    world.bodies.delete('advisor')
    return
  }
  if (!world.bodies.has('advisor')) {
    // Why from the elevator: the advisor has just ridden here, to a judged pane or back home.
    const x = input.advisorEnters ? { x: ELEVATOR_X } : {}
    world.bodies.set('advisor', { ...make(), ...x, speed: ADVISOR_SPEED_PX })
  }
  world.bodies.get('advisor')!.leaving = input.advisorLeaves
}

const ADVISOR_BUBBLE_SECONDS = 6

export function advisorLineShown(world: TeamSceneWorld): string | null {
  const said = world.advisorSaid
  return said && world.clock - said.at < ADVISOR_BUBBLE_SECONDS ? said.line : null
}
