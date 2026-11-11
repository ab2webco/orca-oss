import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { LEAD_SPOT } from './team-scene-lead-rounds'
import { teamSceneArrived as near } from './team-scene-motion'
import type { TeamSceneEmote, TeamSceneSpot } from './team-scene-types'

const VISIT_SPOT: TeamSceneSpot = { x: LEAD_SPOT.x - 0.09, depth: LEAD_SPOT.depth + 0.05 }
export const ENTRY_X = -0.1
const AT_LEAD_SECONDS = { enter: 0.9, handoff: 0.9, finish: 1, leave: 1 } as const
// Why: a team that walked in at stroll speed took 12 s to fill the row; arrivals now land in turn.
const ENTER_SECONDS = 2.2
const ENTER_STAGGER_SECONDS = 0.15

type VisitKind = keyof typeof AT_LEAD_SECONDS
type Visit = {
  kind: VisitKind
  stage: 'queued' | 'toLead' | 'atLead' | 'back'
  at: number
  /** A finish that also carries the report filed with it. */
  report?: boolean
  /** Seconds an entrance waits at the door, so a team that joins at once arrives in turn. */
  delay?: number
}
export type TeamScenePlan = { kind: 'seated' } | Visit

export const emoteFor = (
  world: TeamSceneWorld,
  body: TeamSceneBody,
  kind: TeamSceneEmote,
  seconds: number
): void => {
  body.emote = { kind, until: world.t + seconds }
}

// Why not mid-walk: a member already at or on its way to the lead keeps that visit.
export const visitCanStart = (plan: TeamScenePlan): boolean =>
  plan.kind === 'seated' || plan.stage === 'queued'

export function queueVisit(world: TeamSceneWorld, body: TeamSceneBody, kind: VisitKind): void {
  body.plan = { kind, stage: 'queued', at: world.t }
  if (!world.queue.includes(body.key)) {
    world.queue.push(body.key)
  }
}

/**
 * Joins and leaves walk straight to the seat or off stage, out of the lead's queue: behind
 * other visits a relaunched team left its desks empty for a minute while its cards said working.
 */
export function walkStraight(
  world: TeamSceneWorld,
  body: TeamSceneBody,
  kind: 'enter' | 'leave',
  /** Its place among members joining together: each waits a beat after the one before. */
  turn = 0
): void {
  body.plan = { kind, stage: 'back', at: world.t, delay: turn * ENTER_STAGGER_SECONDS }
  world.queue = world.queue.filter((key) => key !== body.key)
  if (kind === 'leave') {
    world.effects.push({ kind: 'burst', key: body.key, reason: 'goodbye' })
    emoteFor(world, body, 'heart', 1)
  }
}

function arrive(world: TeamSceneWorld, body: TeamSceneBody, plan: Visit): void {
  const { kind } = plan
  const lead = world.bodies.get('lead')!
  body.facing = 1
  lead.facing = -1
  if (kind === 'handoff' || plan.report) {
    world.effects.push({ kind: 'handoff', from: body.key, to: 'lead' })
    emoteFor(world, lead, 'check', 1.1)
  }
  if (kind === 'handoff') {
    return
  }
  world.effects.push({
    kind: 'burst',
    key: body.key,
    reason: kind === 'enter' ? 'welcome' : kind === 'finish' ? 'finish' : 'goodbye'
  })
  emoteFor(world, body, 'heart', 1)
}

/** One step of a member's walk to the lead and on: back to its seat, or off stage. */
export function advanceVisit(
  world: TeamSceneWorld,
  body: TeamSceneBody,
  plan: Visit,
  width: number
): void {
  if (plan.stage === 'queued') {
    body.target = plan.kind === 'enter' ? { x: ENTRY_X, depth: body.home.depth } : body.home
  } else if (plan.stage === 'toLead') {
    body.target = VISIT_SPOT
    if (near(body, width)) {
      Object.assign(plan, { stage: 'atLead', at: world.t })
      arrive(world, body, plan)
    }
  } else if (plan.stage === 'atLead') {
    if (world.t - plan.at >= AT_LEAD_SECONDS[plan.kind]) {
      plan.stage = 'back'
      world.visitor = null
    }
  } else if (plan.kind === 'leave') {
    // Why the left edge: the seats sit left, so the door the team came in by is the near one.
    body.target = { x: ENTRY_X, depth: body.home.depth }
    if (body.x < ENTRY_X + 0.06) {
      world.bodies.delete(body.key)
    }
  } else {
    if (plan.kind === 'enter') {
      if (world.t - plan.at < (plan.delay ?? 0)) {
        return
      }
      body.speed ??= Math.max(32, (Math.abs(body.home.x - body.x) * width) / ENTER_SECONDS)
    }
    body.target = body.home
    if (near(body, width)) {
      delete body.speed
      if (plan.kind === 'enter') {
        world.effects.push({ kind: 'burst', key: body.key, reason: 'welcome' })
        emoteFor(world, body, 'heart', 1)
      }
      body.plan = { kind: 'seated' }
    }
  }
}
