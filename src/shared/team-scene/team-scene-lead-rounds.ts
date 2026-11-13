import { teamSceneArrived as near } from './team-scene-motion'
import { teamSceneAttendSpotOf } from './team-scene-lead-attend'
import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import type { TeamSceneActivity, TeamSceneSpot } from './team-scene-types'

// Why: V30's runner (hdDirect/officeDirect) keeps the stage alive between real events by
// walking work to each busy member; here the lead does it, and only to members really working.
export const LEAD_SPOT: TeamSceneSpot = { x: 0.84, depth: 0.45 }
const REST_SECONDS = 2
const LEAD_STAYS_BELOW_PX = 360
const GIVE_SECONDS = 0.9
const BESIDE_X = 0.075

export type TeamSceneRounds = {
  stage: 'rest' | 'toMember' | 'atMember' | 'home'
  /** give: hand a working member its next piece; attend: stand by a member who asks. */
  purpose: 'give' | 'attend'
  /** The member the lead is visiting, while out. */
  member: string | null
  at: number
  /** The last member handed work, so the next round picks the one after it. */
  lastVisited: string | null
}

export const createTeamSceneRounds = (): TeamSceneRounds => ({
  stage: 'rest',
  purpose: 'give',
  member: null,
  at: 0,
  lastVisited: null
})

const seatedWith = (
  body: TeamSceneBody | undefined,
  activity: TeamSceneActivity
): body is TeamSceneBody =>
  body?.role === 'member' && body.activity === activity && body.plan.kind === 'seated'

const membersWith = (world: TeamSceneWorld, activity: TeamSceneActivity): TeamSceneBody[] =>
  [...world.bodies.values()].filter((b) => seatedWith(b, activity))

function nextWorking(world: TeamSceneWorld): TeamSceneBody | null {
  const working = membersWith(world, 'working')
  if (working.length === 0) {
    return null
  }
  const after = working.findIndex((b) => b.key === world.rounds.lastVisited)
  return working[(after + 1) % working.length]!
}

/** True from when the lead sets out to a member who asks until it is answered: it stands under that tag. */
export const teamSceneLeadAttends = (world: TeamSceneWorld): boolean =>
  world.rounds.purpose === 'attend' &&
  (world.rounds.stage === 'toMember' || world.rounds.stage === 'atMember')

/** True while the lead is at its spot and free to take a member's visit. */
export const leadIsHome = (world: TeamSceneWorld): boolean => world.rounds.stage === 'rest'

function setOut(world: TeamSceneWorld, purpose: TeamSceneRounds['purpose'], key: string): void {
  Object.assign(world.rounds, { stage: 'toMember', purpose, member: key })
}

function stillWanted(world: TeamSceneWorld, asking: TeamSceneBody | undefined): boolean {
  const { rounds } = world
  const member = world.bodies.get(rounds.member ?? '')
  if (world.queue.length > 0) {
    return false
  }
  if (rounds.purpose === 'attend') {
    return seatedWith(member, 'needsYou')
  }
  return !asking && seatedWith(member, 'working')
}

export function stepLeadRounds(world: TeamSceneWorld, width: number): void {
  const lead = world.bodies.get('lead')
  if (!lead) {
    return
  }
  const rounds = world.rounds
  // Why: on a narrow building floor the row has no gap a lead can stand in without covering one.
  if (world.leadStays && width < LEAD_STAYS_BELOW_PX) {
    Object.assign(rounds, { stage: 'rest', member: null })
    lead.target = LEAD_SPOT
    return
  }
  // Why: the scene never contradicts the lead's card: only a working lead hands out work, and a lead
  // that cannot work walks nowhere; any other still goes to a member who needs you (owner, #1167).
  const leading = lead.activity === 'working'
  const asking = lead.activity === 'blocked' ? undefined : membersWith(world, 'needsYou')[0]
  const out = rounds.stage === 'toMember' || rounds.stage === 'atMember'
  const allowed = rounds.purpose === 'attend' ? asking !== undefined : leading
  if (out && (!allowed || !stillWanted(world, asking))) {
    Object.assign(rounds, { stage: 'home', member: null })
  }
  if (rounds.stage === 'home' && asking && world.queue.length === 0) {
    setOut(world, 'attend', asking.key)
  }
  if (rounds.stage === 'rest') {
    lead.target = LEAD_SPOT
    if (world.queue.length > 0) {
      return
    }
    const giveTo = leading && world.t - rounds.at >= REST_SECONDS ? nextWorking(world) : null
    if (asking) {
      setOut(world, 'attend', asking.key)
    } else if (giveTo) {
      setOut(world, 'give', giveTo.key)
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
  const member = world.bodies.get(rounds.member!)!
  const side = member.home.x < LEAD_SPOT.x ? 1 : -1
  if (rounds.stage === 'toMember') {
    // Why halfway at most: past it the lead stands on the next seat, two to one desk.
    const next = world.stations.map((s) => (s.x - member.home.x) * side).filter((d) => d > 0.001)
    const beside = Math.min(BESIDE_X, ...next.map((d) => d / 2))
    lead.target =
      rounds.purpose === 'attend'
        ? teamSceneAttendSpotOf(world, member, width, side)
        : { x: member.home.x + side * beside, depth: member.home.depth + 0.04 }
    if (!near(lead, width)) {
      return
    }
    Object.assign(rounds, { stage: 'atMember', at: world.t })
    if (rounds.purpose === 'give') {
      rounds.lastVisited = member.key
      world.effects.push({ kind: 'handoff', from: 'lead', to: member.key })
      member.emote = { kind: 'check', until: world.t + 1.1 }
    }
  }
  // Why from where it stands: an attending lead may stand on the asker's far side.
  lead.facing = lead.target.x > member.home.x ? -1 : 1
  if (rounds.purpose === 'give' && world.t - rounds.at >= GIVE_SECONDS) {
    Object.assign(rounds, { stage: 'home', member: null })
  }
}
