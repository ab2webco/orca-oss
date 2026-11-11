import type { TeamHost, TeamMachine, TeamMemberCard, TeamSection } from '../team-panel-model-types'

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
 * The team as one floor per machine, the lead's first. Each member's own host places it; the
 * Machines tab only adds cap, count and reach, so a hidden or missing tab still floors everyone.
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
  return [...floors.values()]
}
