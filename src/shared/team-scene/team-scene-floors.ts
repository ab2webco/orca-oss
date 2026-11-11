import type { TeamHost, TeamMachine, TeamMemberCard, TeamSection } from '../team-panel-model-types'
import { teamSceneInputOf } from './team-scene-input'
import type { TeamSceneLeg } from './team-scene-ride-legs'
import type { TeamSceneInput } from './team-scene-types'

/** One machine the team runs on, as a floor of the Office building. */
export type TeamSceneFloor = {
  /** '' for this machine, else the host's name, as the Machines tab names it. */
  key: string
  host: TeamHost
  members: TeamMemberCard[]
  /** The host's member cap and its running count; null when the Machines tab says nothing. */
  cap: number | null
  running: number | null
  reachable: boolean
  /** The lead's own floor, where it stands. */
  lead: boolean
  /** Desks other sessions on the host hold, drawn dim and empty: why a host is full. */
  taken: number
  /** Desks the cap still allows, drawn empty. */
  free: number
}

// Why the name: a machine row with no member on it has no environmentId to match by.
const keyOf = (host: TeamHost): string => (host.kind === 'local' ? '' : host.name)

/**
 * The team as one floor per machine it has members on, the lead's first. Each member's own host
 * places it; the Machines tab only adds cap, count and reach, so a hidden tab still floors everyone.
 */
export function teamSceneFloorsOf(model: {
  lead: { host: TeamHost }
  members: readonly TeamMemberCard[]
  machines: TeamSection<TeamMachine[]> | null
}): TeamSceneFloor[] {
  const rows = model.machines?.kind === 'ready' ? model.machines.value : []
  const floors = new Map<string, TeamSceneFloor>()
  const floorOf = (host: TeamHost): TeamSceneFloor => {
    const key = keyOf(host)
    const known = floors.get(key)
    if (known) {
      return known
    }
    const floor: TeamSceneFloor = {
      key,
      host,
      members: [],
      cap: null,
      running: null,
      reachable: host.kind === 'local' || host.reachable,
      lead: key === keyOf(model.lead.host),
      taken: 0,
      free: 0
    }
    floors.set(key, floor)
    return floor
  }
  floorOf(model.lead.host)
  for (const row of rows) {
    const floor = floorOf(row.host)
    Object.assign(floor, {
      cap: row.cap,
      running: row.running,
      reachable: floor.reachable && row.reading.kind !== 'unreachable'
    })
  }
  for (const member of model.members) {
    const floor = floorOf(member.host)
    floor.members.push(member)
    // Why either: a card that cannot reach its host darkens the floor as much as the tab does.
    if (member.host.kind === 'remote' && !member.host.reachable) {
      floor.reachable = false
    }
  }
  for (const floor of floors.values()) {
    const here = floor.members.length
    // Why the larger: a count read before the team's own cards arrived never hides them.
    const used = Math.max(floor.running ?? here, here)
    floor.taken = used - here
    floor.free = floor.cap === null ? 0 : Math.max(0, floor.cap - used)
  }
  // Why only where our members sit: a machine with nobody of ours stays in the Machines tab.
  return [...floors.values()].filter((floor) => floor.lead || floor.members.length > 0)
}

/** Where each rider is on its trip between the lead's floor and another. */
export type TeamSceneFloorLegs = { lead: TeamSceneLeg; advisor: TeamSceneLeg }

const HOME_LEGS: TeamSceneFloorLegs = { lead: { stage: 'home' }, advisor: { stage: 'home' } }

/**
 * One floor's scene: its own members and empty desks, STOP on the lead's, and the lead and advisor
 * where their trips have them: walking out, gone while the car carries them, in on arrival.
 */
export function teamSceneFloorInputOf(
  model: Parameters<typeof teamSceneInputOf>[0],
  floor: TeamSceneFloor,
  legs: TeamSceneFloorLegs = HOME_LEGS
): TeamSceneInput {
  const advisor = advisorOn(floor, legs.advisor)
  const input = teamSceneInputOf({
    ...model,
    // Why held back: the advisor gestures on a decision it sees arrive, so it arrives with it.
    members:
      advisor === 'gone' && !floor.lead ? floor.members.map(withoutDecisions) : floor.members,
    advisor: advisor === 'gone' ? null : model.advisor,
    stopped: floor.lead ? model.stopped : null
  })
  return {
    ...input,
    ...(floor.lead ? { leadStays: true as const } : { leadless: true as const }),
    ...(advisor === 'enters' ? { advisorEnters: true as const } : {}),
    ...(advisor === 'leaves' ? { advisorLeaves: true as const } : {}),
    desks: { taken: floor.taken, free: floor.free },
    ...rideOn(floor, legs.lead)
  }
}

const withoutDecisions = (member: TeamMemberCard): TeamMemberCard => {
  const { decisions: _held, ...rest } = member
  return rest
}

function advisorOn(
  floor: TeamSceneFloor,
  leg: TeamSceneLeg
): 'here' | 'enters' | 'leaves' | 'gone' {
  if (leg.stage === 'home') {
    return floor.lead ? (leg.returned ? 'enters' : 'here') : 'gone'
  }
  if (floor.lead) {
    return leg.stage === 'out' ? 'leaves' : 'gone'
  }
  if (floor.key !== leg.away) {
    return 'gone'
  }
  return leg.stage === 'there' ? 'enters' : leg.stage === 'back' ? 'leaves' : 'gone'
}

/** Where the lead rides: to a member on another floor it can reach who needs you. */
export type TeamSceneBuildingRide = { floor: string; member: string }

/** The lead's one real reason to leave its floor today: a member on another floor needs you. */
export function teamSceneRideOf(floors: readonly TeamSceneFloor[]): TeamSceneBuildingRide | null {
  for (const floor of floors) {
    const asking =
      floor.lead || !floor.reachable ? undefined : floor.members.find((m) => m.needsYou)
    if (asking) {
      return { floor: floor.key, member: asking.paneKey }
    }
  }
  return null
}

const rideOn = (floor: TeamSceneFloor, leg: TeamSceneLeg): Pick<TeamSceneInput, 'ride'> => {
  if (leg.stage === 'home') {
    return {}
  }
  if (floor.lead) {
    return { ride: 'away' }
  }
  return leg.stage === 'there' && floor.key === leg.away && leg.member
    ? { ride: { guest: leg.member } }
    : {}
}

/**
 * The floor the advisor rides to: one whose member Jev just ruled on, off the lead's floor and
 * reachable. `seen` keeps the panes and decisions already read; a pane's first read replays none.
 */
export function teamSceneJudgedFloorOf(
  floors: readonly TeamSceneFloor[],
  seen: Set<string>
): string | null {
  let judged: string | null = null
  for (const floor of floors) {
    for (const member of floor.members) {
      const pane = `pane\u0000${member.paneKey}`
      const known = seen.has(pane)
      seen.add(pane)
      for (const { id } of member.decisions ?? []) {
        if (!seen.has(id) && known && !floor.lead && floor.reachable) {
          judged = floor.key
        }
        seen.add(id)
      }
    }
  }
  return judged
}
