import { teamSceneArrived as near } from './team-scene-motion'
import { teamSceneAttendSpotOf } from './team-scene-lead-attend'
import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import type { TeamSceneActivity, TeamSceneSpot } from './team-scene-types'

// Why only to an asker: the lead moves for a real event and with none stays at its spot, as in
// the 3D Office; an ambient round to working members read as a loop (ORCA-1336).
export const LEAD_SPOT: TeamSceneSpot = { x: 0.84, depth: 0.45 }
const LEAD_STAYS_BELOW_PX = 360
// Why: a desk reaches past its seat, so the lead steps back only once clear of the last one.
const ROW_CLEAR_X = 0.1

export type TeamSceneRounds = {
  stage: 'rest' | 'toMember' | 'atMember' | 'home'
  /** The member who asks that the lead is standing by, while out. */
  member: string | null
  at: number
}

export const createTeamSceneRounds = (): TeamSceneRounds => ({
  stage: 'rest',
  member: null,
  at: 0
})

const seatedWith = (
  body: TeamSceneBody | undefined,
  activity: TeamSceneActivity
): body is TeamSceneBody =>
  body?.role === 'member' && body.activity === activity && body.plan.kind === 'seated'

const membersWith = (world: TeamSceneWorld, activity: TeamSceneActivity): TeamSceneBody[] =>
  [...world.bodies.values()].filter((b) => seatedWith(b, activity))

/** True from when the lead sets out to a member who asks until it is answered: it stands under that tag. */
export const teamSceneLeadAttends = (world: TeamSceneWorld): boolean =>
  world.rounds.stage === 'toMember' || world.rounds.stage === 'atMember'

/** True while the lead is at its spot and free to take a member's visit. */
export const leadIsHome = (world: TeamSceneWorld): boolean => world.rounds.stage === 'rest'

/**
 * The way home: in front of the row until past its last desk, then back to its spot. Easing to
 * the spot's depth while still over the desks drew the lead behind them (ORCA-1204).
 */
export function leadHomeTargetOf(world: TeamSceneWorld, lead: TeamSceneBody): TeamSceneSpot {
  const rowEnd = Math.max(...world.stations.map((s) => s.x)) + ROW_CLEAR_X
  return lead.x < rowEnd && lead.depth > LEAD_SPOT.depth
    ? { x: LEAD_SPOT.x, depth: lead.depth }
    : LEAD_SPOT
}

function setOut(world: TeamSceneWorld, key: string): void {
  Object.assign(world.rounds, { stage: 'toMember', member: key })
}

const stillWanted = (world: TeamSceneWorld): boolean =>
  world.queue.length === 0 && seatedWith(world.bodies.get(world.rounds.member ?? ''), 'needsYou')

export function stepLeadRounds(world: TeamSceneWorld, width: number): void {
  const lead = world.bodies.get('lead')
  if (!lead) {
    return
  }
  const rounds = world.rounds
  // Why: on a narrow building floor the row has no gap a lead can stand in without covering one.
  if (world.leadStays && width < LEAD_STAYS_BELOW_PX) {
    Object.assign(rounds, { stage: 'rest', member: null })
    lead.target = leadHomeTargetOf(world, lead)
    return
  }
  // Why: a lead that cannot work walks nowhere, as its card says; any other still goes to a member
  // who needs you (owner, #1167).
  const asking = lead.activity === 'blocked' ? undefined : membersWith(world, 'needsYou')[0]
  const out = rounds.stage === 'toMember' || rounds.stage === 'atMember'
  if (out && (!asking || !stillWanted(world))) {
    Object.assign(rounds, { stage: 'home', member: null })
  }
  if (rounds.stage === 'home' && asking && world.queue.length === 0) {
    setOut(world, asking.key)
  }
  if (rounds.stage === 'rest') {
    lead.target = leadHomeTargetOf(world, lead)
    if (world.queue.length > 0) {
      return
    }
    if (asking) {
      setOut(world, asking.key)
    }
    return
  }
  if (rounds.stage === 'home') {
    lead.target = leadHomeTargetOf(world, lead)
    if (near(lead, width)) {
      Object.assign(rounds, { stage: 'rest', at: world.t })
    }
    return
  }
  const member = world.bodies.get(rounds.member!)!
  const side = member.home.x < LEAD_SPOT.x ? 1 : -1
  // Why each frame: a narrowed stage moves the asker's clear spot, so the lead follows it.
  lead.target = teamSceneAttendSpotOf(world, member, width, side)
  if (rounds.stage === 'toMember' && near(lead, width)) {
    Object.assign(rounds, { stage: 'atMember', at: world.t })
  }
  // Why from where it stands: an attending lead may stand on the asker's far side.
  lead.facing = lead.target.x > member.home.x ? -1 : 1
}
