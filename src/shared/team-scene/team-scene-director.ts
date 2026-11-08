import { teamSceneEventsBetween } from './team-scene-events'
import {
  moveTeamSceneBody,
  teamSceneArrived as near,
  type TeamSceneMover
} from './team-scene-motion'
import { seatPlanOf } from './team-scene-seats'
import type {
  TeamSceneActivity,
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneEmote,
  TeamSceneInput,
  TeamSceneSpot
} from './team-scene-types'

const LEAD_SPOT: TeamSceneSpot = { x: 0.84, depth: 0.45 }
// Why left of the lead: its bubble hangs leftward, leaving the column above the lead free.
const ADVISOR_SPOT: TeamSceneSpot = { x: 0.74, depth: 0.15 }
const VISIT_SPOT: TeamSceneSpot = { x: LEAD_SPOT.x - 0.09, depth: LEAD_SPOT.depth + 0.05 }
const ENTRY_X = -0.1
const EXIT_X = 1.14
const AT_LEAD_SECONDS = { enter: 0.9, handoff: 0.9, leave: 1 } as const
const CHEER_SECONDS = 2.2
const ADVISOR_RAISE_SECONDS = 1.4
const ADVISOR_BUBBLE_SECONDS = 6

type VisitKind = keyof typeof AT_LEAD_SECONDS
type Plan =
  | { kind: 'seated' }
  | { kind: VisitKind; stage: 'queued' | 'toLead' | 'atLead' | 'back'; at: number }

export type TeamSceneBody = TeamSceneMover & {
  key: string
  role: TeamSceneActor['role']
  name: string
  characterKey: string | null
  activity: TeamSceneActivity
  home: TeamSceneSpot
  plan: Plan
  emote: { kind: TeamSceneEmote; until: number } | null
}

export type TeamSceneWorld = {
  t: number
  /** Real seconds the scene has run, for the advisor's bubble; `t` takes each frame's capped step. */
  clock: number
  last: TeamSceneInput | null
  bodies: Map<string, TeamSceneBody>
  queue: string[]
  visitor: string | null
  cheerUntil: number
  advisorSaid: { line: string; at: number } | null
  advisorRaiseUntil: number
  effects: TeamSceneEffect[]
  /** Members beyond the seats, drawn as +N. */
  overflow: number
  /** Every seat's spot, so a style draws the stations even while their members walk. */
  stations: TeamSceneSpot[]
}

export function createTeamSceneWorld(): TeamSceneWorld {
  return {
    t: 0,
    clock: 0,
    last: null,
    bodies: new Map(),
    queue: [],
    visitor: null,
    cheerUntil: 0,
    advisorSaid: null,
    advisorRaiseUntil: 0,
    effects: [],
    overflow: 0,
    stations: []
  }
}

function bodyAt(
  key: string,
  role: TeamSceneActor['role'],
  spot: TeamSceneSpot,
  facing: 1 | -1,
  plan: Plan = { kind: 'seated' }
): TeamSceneBody {
  return {
    key,
    role,
    name: key,
    characterKey: null,
    activity: 'resting',
    home: spot,
    x: spot.x,
    depth: spot.depth,
    target: spot,
    v: 0,
    facing,
    gait: 0,
    plan,
    emote: null
  }
}

const emote = (
  world: TeamSceneWorld,
  body: TeamSceneBody,
  kind: TeamSceneEmote,
  seconds: number
): void => {
  body.emote = { kind, until: world.t + seconds }
}

const queueVisit = (world: TeamSceneWorld, body: TeamSceneBody, kind: VisitKind): void => {
  body.plan = { kind, stage: 'queued', at: world.t }
  if (!world.queue.includes(body.key)) {
    world.queue.push(body.key)
  }
}

export function applyTeamSceneInput(world: TeamSceneWorld, input: TeamSceneInput): void {
  const events = teamSceneEventsBetween(world.last, input)
  world.last = input
  const { bodies } = world
  const lead = bodies.get('lead') ?? bodyAt('lead', 'lead', LEAD_SPOT, -1)
  bodies.set('lead', Object.assign(lead, input.lead, { key: 'lead' }))
  if (input.advisor && !bodies.has('advisor')) {
    bodies.set('advisor', bodyAt('advisor', 'advisor', ADVISOR_SPOT, -1))
  } else if (!input.advisor) {
    bodies.delete('advisor')
  }

  const joined = new Set(events.flatMap((e) => (e.kind === 'join' ? [e.key] : [])))
  const plan = seatPlanOf(input.members)
  const byKey = new Map(input.members.map((m) => [m.key, m]))
  const seatedKeys = new Set(plan.seats.map((s) => s.key))
  for (const { key, spot } of plan.seats) {
    const m = byKey.get(key)!
    let body = bodies.get(key)
    if (!body) {
      body = bodyAt(key, 'member', joined.has(key) ? { x: ENTRY_X, depth: spot.depth } : spot, 1)
      bodies.set(key, body)
      if (joined.has(key)) {
        queueVisit(world, body, 'enter')
      }
    }
    Object.assign(body, {
      name: m.name,
      characterKey: m.characterKey,
      activity: m.activity,
      home: spot
    })
  }
  for (const body of bodies.values()) {
    if (body.role !== 'member' || seatedKeys.has(body.key) || body.plan.kind === 'leave') {
      continue
    }
    if (byKey.has(body.key)) {
      bodies.delete(body.key) // pushed past the seats into +N
    } else {
      queueVisit(world, body, 'leave')
    }
  }

  for (const event of events) {
    const body = 'key' in event ? bodies.get(event.key) : undefined
    if (event.kind === 'handoff' && body?.plan.kind === 'seated') {
      queueVisit(world, body, 'handoff')
    } else if (event.kind === 'merge') {
      world.cheerUntil = world.t + CHEER_SECONDS
      world.effects.push({ kind: 'burst', key: event.key, reason: 'merge' })
      for (const b of bodies.values()) {
        emote(world, b, 'star', CHEER_SECONDS)
      }
    } else if (event.kind === 'advisorSpoke') {
      world.advisorSaid = { line: event.line, at: world.clock }
      world.advisorRaiseUntil = world.t + ADVISOR_RAISE_SECONDS
    }
  }
  world.overflow = plan.overflow
  world.stations = plan.seats.map((s) => s.spot)
}

function arrive(world: TeamSceneWorld, body: TeamSceneBody, kind: VisitKind): void {
  const lead = world.bodies.get('lead')!
  body.facing = 1
  lead.facing = -1
  if (kind === 'handoff') {
    world.effects.push({ kind: 'handoff', from: body.key, to: 'lead' })
    emote(world, lead, 'check', 1.1)
    return
  }
  world.effects.push({
    kind: 'burst',
    key: body.key,
    reason: kind === 'enter' ? 'welcome' : 'goodbye'
  })
  emote(world, body, 'heart', 1)
}

function advancePlan(world: TeamSceneWorld, body: TeamSceneBody, width: number): void {
  const { plan } = body
  if (plan.kind === 'seated') {
    body.target = body.home
    return
  }
  if (plan.stage === 'queued') {
    body.target = plan.kind === 'enter' ? { x: ENTRY_X, depth: body.home.depth } : body.home
  } else if (plan.stage === 'toLead') {
    body.target = VISIT_SPOT
    if (near(body, width)) {
      Object.assign(plan, { stage: 'atLead', at: world.t })
      arrive(world, body, plan.kind)
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

export function stepTeamScene(
  world: TeamSceneWorld,
  dt: number,
  /** `elapsed`: the real seconds behind a step capped for motion; it defaults to `dt`. */
  opts: { width: number; elapsed?: number }
): void {
  world.t += dt
  world.clock += opts.elapsed ?? dt
  if (world.t < world.cheerUntil) {
    return
  }
  if (!world.visitor) {
    const next = world.queue.shift()
    const body = next ? world.bodies.get(next) : undefined
    if (body && body.plan.kind !== 'seated') {
      body.plan.stage = 'toLead'
      world.visitor = body.key
    }
  }
  for (const body of world.bodies.values()) {
    if (body.role === 'member') {
      advancePlan(world, body, opts.width)
    }
  }
  for (const body of world.bodies.values()) {
    moveTeamSceneBody(body, dt, opts.width)
  }
}

/** Reduced motion: every pending walk ends where it would, with no frames in between. */
export function settleTeamScene(world: TeamSceneWorld): void {
  for (const body of world.bodies.values()) {
    if (body.plan.kind === 'leave') {
      world.bodies.delete(body.key)
      continue
    }
    Object.assign(body, { plan: { kind: 'seated' }, x: body.home.x, depth: body.home.depth, v: 0 })
    body.target = body.home
    body.emote = null
  }
  Object.assign(world, { queue: [], visitor: null, cheerUntil: 0, effects: [] })
}

export function drainTeamSceneEffects(world: TeamSceneWorld): TeamSceneEffect[] {
  return world.effects.splice(0)
}

export function advisorLineShown(world: TeamSceneWorld): string | null {
  const said = world.advisorSaid
  return said && world.clock - said.at < ADVISOR_BUBBLE_SECONDS ? said.line : null
}
