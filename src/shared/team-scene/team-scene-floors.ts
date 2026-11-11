import type { TeamHost, TeamMachine, TeamMemberCard, TeamSection } from '../team-panel-model-types'
import { teamSceneInputOf } from './team-scene-input'
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

/**
 * One floor's scene: its own members and empty desks; the lead and STOP only on its own, and the
 * advisor there too unless it rode to `advisorFloor`, where Jev just ruled on a member.
 */
export function teamSceneFloorInputOf(
  model: Parameters<typeof teamSceneInputOf>[0],
  floor: TeamSceneFloor,
  ride: TeamSceneBuildingRide | null = null,
  advisorFloor: string | null = null
): TeamSceneInput {
  const advisorHere = advisorFloor === null ? floor.lead : floor.key === advisorFloor
  const input = teamSceneInputOf({
    ...model,
    members: floor.members,
    advisor: advisorHere ? model.advisor : null,
    stopped: floor.lead ? model.stopped : null
  })
  return {
    ...input,
    ...(advisorHere && !floor.lead ? { advisorEnters: true as const } : {}),
    ...(floor.lead ? { leadStays: true as const } : { leadless: true as const }),
    desks: { taken: floor.taken, free: floor.free },
    ...rideOn(floor, ride)
  }
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

const rideOn = (
  floor: TeamSceneFloor,
  ride: TeamSceneBuildingRide | null
): Pick<TeamSceneInput, 'ride'> => {
  if (!ride) {
    return {}
  }
  if (floor.lead) {
    return { ride: 'away' }
  }
  return floor.key === ride.floor ? { ride: { guest: ride.member } } : {}
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
