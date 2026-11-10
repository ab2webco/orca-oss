import { teamSceneArrived as near } from './team-scene-motion'
import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import type { TeamSceneSpot } from './team-scene-types'

// Why: V30's runner (hdDirect/officeDirect) keeps the stage alive between real events by
// walking work to each busy member; here the lead does it, and only to members really working.
export const LEAD_SPOT: TeamSceneSpot = { x: 0.84, depth: 0.45 }
const REST_SECONDS = 2
const GIVE_SECONDS = 0.9
const BESIDE_X = 0.075

export type TeamSceneRounds = {
  stage: 'rest' | 'toMember' | 'giving' | 'home'
  /** The member the lead is visiting, while out. */
  member: string | null
  at: number
  /** The last member visited, so the next round picks the one after it. */
  lastVisited: string | null
}

export const createTeamSceneRounds = (): TeamSceneRounds => ({
  stage: 'rest',
  member: null,
  at: 0,
  lastVisited: null
})

const isWorkingSeated = (body: TeamSceneBody | undefined): body is TeamSceneBody =>
  body?.role === 'member' && body.activity === 'working' && body.plan.kind === 'seated'

function nextWorking(world: TeamSceneWorld): TeamSceneBody | null {
  const working = [...world.bodies.values()].filter(isWorkingSeated)
  if (working.length === 0) {
    return null
  }
  const after = working.findIndex((b) => b.key === world.rounds.lastVisited)
  return working[(after + 1) % working.length]!
}

function goHome(world: TeamSceneWorld, lead: TeamSceneBody): void {
  Object.assign(world.rounds, { stage: 'home', member: null })
  lead.target = LEAD_SPOT
}

/** True while the lead is at its spot and free to take a member's visit. */
export const leadIsHome = (world: TeamSceneWorld): boolean => world.rounds.stage === 'rest'

export function stepLeadRounds(world: TeamSceneWorld, width: number): void {
  const lead = world.bodies.get('lead')
  if (!lead) {
    return
  }
  const rounds = world.rounds
  if (rounds.stage === 'rest') {
    lead.target = LEAD_SPOT
    const next = world.queue.length === 0 && world.t - rounds.at >= REST_SECONDS
    const member = next ? nextWorking(world) : null
    if (member) {
      Object.assign(rounds, { stage: 'toMember', member: member.key })
    }
    return
  }
  if (rounds.stage === 'home') {
    lead.target = LEAD_SPOT
    if (near(lead, width)) {
      Object.assign(rounds, { stage: 'rest', at: world.t })
    }
    return
  }
  const member = world.bodies.get(rounds.member ?? '')
  if (!isWorkingSeated(member) || world.queue.length > 0) {
    goHome(world, lead)
    return
  }
  if (rounds.stage === 'toMember') {
    const side = member.home.x < LEAD_SPOT.x ? 1 : -1
    lead.target = { x: member.home.x + side * BESIDE_X, depth: member.home.depth + 0.04 }
    if (near(lead, width)) {
      Object.assign(rounds, { stage: 'giving', at: world.t, lastVisited: member.key })
      lead.facing = side === 1 ? -1 : 1
      world.effects.push({ kind: 'handoff', from: 'lead', to: member.key })
      member.emote = { kind: 'check', until: world.t + 1.1 }
    }
    return
  }
  if (world.t - rounds.at >= GIVE_SECONDS) {
    goHome(world, lead)
  }
}
