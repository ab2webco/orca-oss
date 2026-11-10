import { teamSceneEventsBetween } from './team-scene-events'
import { moveTeamSceneBody, type TeamSceneMover } from './team-scene-motion'
import {
  createTeamSceneRounds,
  LEAD_SPOT,
  leadIsHome,
  stepLeadRounds,
  type TeamSceneRounds
} from './team-scene-lead-rounds'
import {
  createAdvisorWalk,
  queueJudgment,
  stepAdvisorWalk,
  type TeamSceneAdvisorWalk
} from './team-scene-advisor-walk'
import { seatPlanOf } from './team-scene-seats'
import {
  grownSite,
  keepTrophy,
  siteSpotOf,
  type TeamSceneSite,
  type TeamSceneSiteView
} from './team-scene-sites'
import { createTeamSceneWork, stepTeamSceneWork, type TeamSceneWork } from './team-scene-work-loop'
import type {
  TeamSceneActivity,
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneEmote,
  TeamSceneInput,
  TeamSceneSpot
} from './team-scene-types'
import {
  advanceVisit,
  emoteFor as emote,
  ENTRY_X,
  queueVisit,
  walkStraight,
  visitCanStart,
  type TeamScenePlan
} from './team-scene-visits'

// Why left of the lead: its bubble hangs leftward, leaving the column above the lead free.
const ADVISOR_SPOT: TeamSceneSpot = { x: 0.74, depth: 0.15 }
const CHEER_SECONDS = 2.2
const CHECK_SECONDS = 1.2
const ADVISOR_RAISE_SECONDS = 1.4
const ADVISOR_BUBBLE_SECONDS = 6

type Plan = TeamScenePlan

export type TeamSceneBody = TeamSceneMover & {
  key: string
  role: TeamSceneActor['role']
  name: string
  characterKey: string | null
  activity: TeamSceneActivity
  home: TeamSceneSpot
  plan: Plan
  emote: { kind: TeamSceneEmote; until: number } | null
  site: TeamSceneSite
  work: TeamSceneWork
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
  /** The lead's walks to working members between real events. */
  rounds: TeamSceneRounds
  /** Each seat's build at its real stage, for styles to draw beside the station. */
  sites: TeamSceneSiteView[]
  /** Finished builds of merged work, oldest first; they outlive their members. */
  trophies: { key: string; name: string }[]
  layout: TeamSceneLayout
  advisorWalk: TeamSceneAdvisorWalk
}

/** How a style seats its team: a row's length, and whether work keeps members at their desks. */
export type TeamSceneLayout = { rowSize: number; workSeated: boolean }
const GROUND_LAYOUT: TeamSceneLayout = { rowSize: 4, workSeated: false }

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
    stations: [],
    rounds: createTeamSceneRounds(),
    sites: [],
    trophies: [],
    layout: GROUND_LAYOUT,
    advisorWalk: createAdvisorWalk()
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
    emote: null,
    site: { stage: 0, broken: false },
    work: createTeamSceneWork()
  }
}

export function applyTeamSceneInput(
  world: TeamSceneWorld,
  input: TeamSceneInput,
  layout: TeamSceneLayout = GROUND_LAYOUT
): void {
  const events = teamSceneEventsBetween(world.last, input)
  world.last = input
  world.layout = layout
  const { bodies } = world
  const lead = bodies.get('lead') ?? bodyAt('lead', 'lead', LEAD_SPOT, -1)
  bodies.set('lead', Object.assign(lead, input.lead, { key: 'lead' }))
  if (input.advisor && !bodies.has('advisor')) {
    bodies.set('advisor', bodyAt('advisor', 'advisor', ADVISOR_SPOT, -1))
  } else if (!input.advisor) {
    bodies.delete('advisor')
  }

  const joined = new Set(events.flatMap((e) => (e.kind === 'join' ? [e.key] : [])))
  const plan = seatPlanOf(input.members, layout.rowSize)
  const byKey = new Map(input.members.map((m) => [m.key, m]))
  const seatedKeys = new Set(plan.seats.map((s) => s.key))
  for (const { key, spot } of plan.seats) {
    const m = byKey.get(key)!
    let body = bodies.get(key)
    if (!body) {
      body = bodyAt(key, 'member', joined.has(key) ? { x: ENTRY_X, depth: spot.depth } : spot, 1)
      bodies.set(key, body)
      if (joined.has(key)) {
        walkStraight(world, body, 'enter')
      }
    }
    Object.assign(body, {
      name: m.name,
      characterKey: m.characterKey,
      activity: m.activity,
      home: spot,
      site: grownSite(body.site, m.site)
    })
  }
  for (const body of bodies.values()) {
    if (body.role !== 'member' || seatedKeys.has(body.key) || body.plan.kind === 'leave') {
      continue
    }
    if (byKey.has(body.key)) {
      bodies.delete(body.key) // pushed past the seats into +N
    } else {
      walkStraight(world, body, 'leave')
    }
  }

  for (const event of events) {
    const body = 'key' in event ? bodies.get(event.key) : undefined
    if (event.kind === 'handoff' && body?.plan.kind === 'seated') {
      queueVisit(world, body, 'handoff')
    } else if (event.kind === 'finish' && body && visitCanStart(body.plan)) {
      const report = body.plan.kind === 'handoff'
      queueVisit(world, body, 'finish')
      Object.assign(body.plan, { report })
      emote(world, body, 'check', CHECK_SECONDS)
    } else if (event.kind === 'merge') {
      keepTrophy(world.trophies, { key: event.key, name: byKey.get(event.key)?.name ?? event.key })
      world.cheerUntil = world.t + CHEER_SECONDS
      world.effects.push({ kind: 'burst', key: event.key, reason: 'merge' })
      for (const b of bodies.values()) {
        emote(world, b, 'star', CHEER_SECONDS)
      }
    } else if (event.kind === 'advisorSpoke') {
      world.advisorSaid = { line: event.line, at: world.clock }
      world.advisorRaiseUntil = world.t + ADVISOR_RAISE_SECONDS
    } else if (event.kind === 'judged') {
      queueJudgment(world, event.key, event.gesture)
    }
  }
  world.overflow = plan.overflow
  world.stations = plan.seats.map((s) => s.spot)
  world.sites = plan.seats.map(({ key, spot }) => ({
    key,
    spot: siteSpotOf(spot),
    ...bodies.get(key)!.site
  }))
}

function advancePlan(world: TeamSceneWorld, body: TeamSceneBody, width: number): void {
  const { plan } = body
  if (plan.kind === 'seated') {
    stepTeamSceneWork(world, body, width)
  } else {
    advanceVisit(world, body, plan, width)
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
  if (!world.visitor && leadIsHome(world)) {
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
  if (!world.visitor) {
    stepLeadRounds(world, opts.width)
  }
  stepAdvisorWalk(world, opts.width)
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
    body.work = createTeamSceneWork()
  }
  Object.assign(world, {
    queue: [],
    visitor: null,
    cheerUntil: 0,
    effects: [],
    rounds: createTeamSceneRounds(),
    advisorWalk: createAdvisorWalk()
  })
}

export function drainTeamSceneEffects(world: TeamSceneWorld): TeamSceneEffect[] {
  return world.effects.splice(0)
}

export function advisorLineShown(world: TeamSceneWorld): string | null {
  const said = world.advisorSaid
  return said && world.clock - said.at < ADVISOR_BUBBLE_SECONDS ? said.line : null
}
