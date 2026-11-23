import { office3dCab, type Office3dCab } from './team-office3d-elevator'
import type { Office3dLayout } from './team-office3d-layout'
import { office3dLeadRoundOf, type Office3dRound } from './team-office3d-walkers'
import { office3dMembersRead, type Office3dMember } from './team-office3d-members'
import { office3dQueued, type Office3dQueue } from './team-office3d-planner'
import { office3dRefloor, type Office3dFloorKeys } from './team-office3d-refloor'
import type { TeamSceneInput } from './team-scene-types'

// Why kept across reads: the stage is rebuilt on every read of the team, and a trip already under
// way must carry on, not restart; only a change between two reads starts a new one (ORCA-1317).

/** The building's moving parts on the clock: its one lift, and the lead's planned trips. */
export type Office3dTraffic = {
  cab: Office3dCab | null
  last: TeamSceneInput | null
  lead: Office3dRound | null
  /** Each member's place, seat and trip; one that left stays until it is out of the door. */
  members: Map<string, Office3dMember>
  /** The call-panel lines the lead and the members share. */
  queue: Office3dQueue
  /** The floors all of it was planned on, so a floor that comes or goes is carried over. */
  floors: Office3dFloorKeys | null
}

export const office3dTraffic = (): Office3dTraffic => ({
  cab: null,
  last: null,
  lead: null,
  members: new Map(),
  queue: new Map(),
  floors: null
})

/**
 * The lead's events between two reads, and nothing else: a member whose CI just went red gets a
 * talk at its desk; a member that just joined gets the lead's folder. A question needs no trip:
 * the member comes to the lead's office.
 */
export function office3dLeadEventsOf(
  prev: TeamSceneInput,
  next: TeamSceneInput
): { talk: string[]; brief: string[] } {
  const before = new Map(prev.members.map((m) => [m.key, m]))
  const talk: string[] = []
  const brief: string[] = []
  for (const m of next.members) {
    const old = before.get(m.key)
    if (!old) {
      brief.push(m.key)
    } else if (m.ci === 'failure' && old.ci !== 'failure') {
      talk.push(m.key)
    }
  }
  return { talk, brief }
}

/**
 * Reads the team at `now` (seconds on the stage's clock): the first read only seats the lead; each
 * later one adds a trip for its events, after any trip still under way, and none without them.
 */
export function office3dTrafficRead(
  traffic: Office3dTraffic,
  layout: Office3dLayout,
  input: TeamSceneInput,
  now: number,
  pace: string | undefined
): void {
  const leadFloor = Math.max(
    0,
    layout.floors.findIndex((f) => f.lead)
  )
  traffic.cab ??= office3dCab(leadFloor)
  office3dRefloor(traffic, layout, now, pace)
  const prev = traffic.last
  traffic.last = input
  office3dMembersRead({
    members: traffic.members,
    layout,
    input: input.members,
    cab: traffic.cab,
    now,
    pace,
    first: prev === null,
    queue: traffic.queue
  })
  const seated = () =>
    office3dLeadRoundOf({ layout, needs: [], visits: [], pace, start: now, cab: traffic.cab! })
  if (!prev || !traffic.lead) {
    traffic.lead = { ...seated(), total: Infinity }
    return
  }
  const { talk, brief } = office3dLeadEventsOf(prev, input)
  if (talk.length === 0 && brief.length === 0) {
    return
  }
  // Busy until its last trip is back at the desk; sitting there is not busy.
  const busyUntil = traffic.lead.steps
    .filter((s) => !(s.kind === 'hold' && s.pose === 'desk'))
    .reduce((end, s) => Math.max(end, s.start + s.dur), now)
  const start = Math.max(now, busyUntil)
  const trip = office3dLeadRoundOf({
    layout,
    needs: talk,
    visits: brief,
    pace,
    start,
    cab: traffic.cab,
    queued: office3dQueued(traffic.queue)
  })
  // Why cut at the trip's start: it sits until the event, then gets up, never both at once.
  const kept = traffic.lead.steps
    .filter((s) => s.start < start)
    .map((s) => (s.start + s.dur > start ? { ...s, dur: start - s.start } : s))
  traffic.lead = { steps: [...kept, ...trip.steps], total: Infinity, cab: traffic.cab }
}
