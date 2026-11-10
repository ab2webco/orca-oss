import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { LEAD_SPOT } from './team-scene-lead-rounds'
import { teamSceneArrived as near } from './team-scene-motion'
import type { TeamSceneEmote, TeamSceneSpot } from './team-scene-types'

const VISIT_SPOT: TeamSceneSpot = { x: LEAD_SPOT.x - 0.09, depth: LEAD_SPOT.depth + 0.05 }
export const ENTRY_X = -0.1
const EXIT_X = 1.14
const AT_LEAD_SECONDS = { enter: 0.9, handoff: 0.9, finish: 1, leave: 1 } as const

type VisitKind = keyof typeof AT_LEAD_SECONDS
type Visit = {
  kind: VisitKind
  stage: 'queued' | 'toLead' | 'atLead' | 'back'
  at: number
  /** A finish that also carries the report filed with it. */
  report?: boolean
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
    body.target = { x: EXIT_X, depth: VISIT_SPOT.depth }
    if (body.x > EXIT_X - 0.06) {
      world.bodies.delete(body.key)
    }
  } else {
    body.target = body.home
    if (near(body, width)) {
      body.plan = { kind: 'seated' }
    }
  }
}
