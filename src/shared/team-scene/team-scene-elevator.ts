import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { LEAD_SPOT } from './team-scene-lead-rounds'
import type { TeamSceneInput, TeamSceneSpot } from './team-scene-types'

/** Where the building's elevator stands: just off each floor's right edge. */
export const ELEVATOR_X = 1.04
const BESIDE = { x: 0.07, depth: 0.12 }

/** The lead leaving its floor for another, or the member it visits here from another floor. */
export type TeamSceneRide = 'away' | { guest: string }

const elevator = (lead: TeamSceneBody): TeamSceneSpot => ({ x: ELEVATOR_X, depth: lead.depth })

// Why in front and to one side: the visiting lead stands by the member's desk, never over it.
const besideOf = (member: TeamSceneBody): TeamSceneSpot => {
  const side = member.home.x + BESIDE.x > 0.92 ? -1 : 1
  return { x: member.home.x + side * BESIDE.x, depth: member.home.depth + BESIDE.depth }
}

/** Brings a visiting lead in at the elevator, or marks one whose visit is over to leave. */
export function applyTeamSceneRide(
  world: TeamSceneWorld,
  input: TeamSceneInput,
  newLead: (spot: TeamSceneSpot) => TeamSceneBody
): void {
  const ride = input.ride ?? null
  const lead = world.bodies.get('lead')
  if (input.leadless) {
    if (typeof ride === 'object' && ride !== null) {
      const guest = lead ?? newLead({ x: ELEVATOR_X, depth: LEAD_SPOT.depth })
      world.bodies.set(
        'lead',
        Object.assign(guest, input.lead, { key: 'lead', leaving: undefined })
      )
    } else if (lead) {
      lead.leaving = true
    }
  }
  world.ride = ride
}

/**
 * Steers the lead on a ride; false leaves it to its rounds. At any width: the default Team panel's
 * floor is 195 px, and the visitor stands in front of its member, so it never covers one.
 */
export function stepTeamSceneRide(world: TeamSceneWorld): boolean {
  const lead = world.bodies.get('lead')
  if (!lead) {
    return false
  }
  const ride = world.ride
  if (typeof ride === 'object' && ride !== null) {
    lead.hidden = undefined
    const member = world.bodies.get(ride.guest)
    if (member) {
      lead.target = besideOf(member)
    }
    return true
  }
  if (lead.leaving) {
    lead.target = elevator(lead)
    if (lead.x >= ELEVATOR_X - 0.01) {
      world.bodies.delete('lead')
    }
    return true
  }
  if (ride === 'away') {
    lead.target = elevator(lead)
    lead.hidden = lead.x >= ELEVATOR_X - 0.01 ? true : undefined
    return true
  }
  if (lead.hidden) {
    // Back from a ride: out of the elevator, and its rounds walk it home.
    Object.assign(lead, { hidden: undefined, x: ELEVATOR_X })
  }
  return false
}

/** Under reduced motion a ride shows where it ends: the guest by its member, the away lead gone. */
export function settleTeamSceneRide(world: TeamSceneWorld): void {
  const lead = world.bodies.get('lead')
  const ride = world.ride
  if (!lead) {
    return
  }
  if (lead.leaving) {
    world.bodies.delete('lead')
  } else if (typeof ride === 'object' && ride !== null) {
    const member = world.bodies.get(ride.guest)
    const spot = member ? besideOf(member) : elevator(lead)
    Object.assign(lead, { x: spot.x, depth: spot.depth, target: spot, hidden: undefined })
  } else if (ride === 'away') {
    // Why in the elevator: the next step keeps a lead hidden only once it stands there.
    Object.assign(lead, { x: ELEVATOR_X, target: elevator(lead), hidden: true })
  }
}
