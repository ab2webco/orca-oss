import { dioramaPaceOf } from './team-diorama-lead-round'
import { OFFICE3D_DOOR_SWING, office3dCabCut, office3dCabFloorAt } from './team-office3d-elevator'
import { OFFICE3D_LIFT, type Office3dLayout } from './team-office3d-layout'
import { office3dCabOutAt, office3dTripTo } from './team-office3d-members'
import { office3dPlanner, office3dQueued } from './team-office3d-planner'
import type { Office3dTraffic } from './team-office3d-traffic'
import {
  OFFICE3D_EXIT,
  OFFICE3D_JUMP,
  office3dLeadRoundOf,
  office3dWalkerAt,
  type Office3dRound,
  type Office3dStep
} from './team-office3d-walkers'

// Why: the traffic kept floor indexes across reads, and a floor that went away left the cab riding
// past the top with the lead in it (ORCA-1374).

/** The floors a traffic was planned on, bottom up, and the lead's. */
export type Office3dFloorKeys = { keys: string[]; lead: string }

const keysOf = (layout: Office3dLayout): Office3dFloorKeys => ({
  keys: layout.floors.map((f) => f.key),
  lead: layout.floors.find((f) => f.lead)?.key ?? ''
})

/** An old floor index, maybe mid-ride, as a new one; a floor that went away becomes the one below. */
function renumberOf(prev: readonly string[], next: readonly string[]) {
  const index = new Map(next.map((key, i) => [key, i]))
  const moved = prev.map((key) => index.get(key))
  return (x: number): number => {
    const base = Math.max(0, Math.min(prev.length - 1, Math.round(x)))
    for (let j = base; j >= 0; j--) {
      const to = moved[j]
      if (to !== undefined) {
        return to + (j === base ? x - base : 0)
      }
    }
    return 0
  }
}

const floorsOf = (s: Office3dStep): number[] =>
  s.kind === 'jump' ? [s.from.floor, s.to.floor] : s.kind === 'ride' ? [] : [s.floor]

const renumbered = (s: Office3dStep, f: (x: number) => number): Office3dStep =>
  s.kind === 'jump'
    ? { ...s, from: { ...s.from, floor: f(s.from.floor) }, to: { ...s.to, floor: f(s.to.floor) } }
    : s.kind === 'ride'
      ? s
      : { ...s, floor: f(s.floor) }

const stepAt = (plan: Office3dRound, t: number) =>
  plan.steps.find((s) => t >= s.start && t < s.start + s.dur)

/** Carries the traffic over to `layout`'s floors at `now`: a moved floor keeps its trips,
 * re-numbered; when one went away or the lead's machine changed, the cab ends its ride inside,
 * books nothing more, whoever needed it plans again, and whoever stood on the gone floor is gone. */
export function office3dRefloor(
  traffic: Office3dTraffic,
  layout: Office3dLayout,
  now: number,
  pace: string | undefined
): void {
  const next = keysOf(layout)
  const prev = traffic.floors
  traffic.floors = next
  const cab = traffic.cab
  if (!prev || !cab || (prev.lead === next.lead && prev.keys.join('\n') === next.keys.join('\n'))) {
    return
  }
  const f = renumberOf(prev.keys, next.keys)
  const gone = (x: number) => !next.keys.includes(prev.keys[Math.round(x)] ?? '\0')
  const cut = prev.lead !== next.lead || prev.keys.some((key) => !next.keys.includes(key))
  // Read before re-numbering: who stands on a floor that went away, and who still needs the cab.
  const lost = (plan: Office3dRound) => {
    const at = office3dWalkerAt(plan, now)
    return stepAt(plan, now)?.kind !== 'ride' && at.pose !== 'gone' && gone(at.floor)
  }
  const replan = (plan: Office3dRound) =>
    plan.steps.some(
      (s) => s.start + s.dur > now && (s.kind === 'ride' || floorsOf(s).some((x) => gone(x)))
    )
  const cabAt = office3dCabFloorAt(cab, now)
  const lead = traffic.lead
  const leadLost = lead ? lost(lead) : false
  const leadReplan = lead !== null && cut && (leadLost || prev.lead !== next.lead || replan(lead))
  const members = [...traffic.members.values()].map((m) => ({
    m,
    lost: cut && lost(m.plan),
    replan: cut && replan(m.plan)
  }))

  cab.home = f(cab.home)
  cab.rides = cab.rides.map((r) => ({ ...r, from: f(r.from), to: f(r.to) }))
  traffic.queue = new Map(
    cut ? [] : [...traffic.queue].map(([floor, waits]) => [f(floor), waits] as const)
  )
  const refloor = (plan: Office3dRound): Office3dRound => ({
    ...plan,
    steps: plan.steps.map((s) => renumbered(s, f))
  })
  if (lead) {
    traffic.lead = refloor(lead)
  }
  for (const { m } of members) {
    m.plan = refloor(m.plan)
    m.slot = m.slot ? { ...m.slot, floor: f(m.slot.floor) } : null
  }
  if (!cut) {
    return
  }

  const { speed } = dioramaPaceOf(pace)
  const top = layout.floors.length - 1
  const end = office3dCabCut(cab, now, Math.min(top, Math.max(0, cabAt)), speed)
  // Riders of the ride under way arrive when the cab now does, and wait in it for the doors.
  const rideOn = (plan: Office3dRound) => {
    const step = stepAt(plan, now)
    if (step?.kind !== 'ride' || end === null) {
      return
    }
    const p = office3dPlanner(
      end,
      Math.round(office3dCabFloorAt(cab, end)),
      step.at ?? OFFICE3D_LIFT,
      pace
    )
    p.hold('idle', OFFICE3D_DOOR_SWING / speed, null)
    plan.steps = [
      ...plan.steps.slice(0, plan.steps.indexOf(step)),
      { ...step, dur: end - step.start },
      ...p.steps
    ]
  }
  const queued = office3dQueued(traffic.queue)
  for (const { m, lost: away, replan: again } of members) {
    if (away) {
      traffic.members.delete(m.key)
    } else if (again) {
      rideOn(m.plan)
      office3dTripTo(m, m.leaving ? null : m.slot, layout, cab, now, pace, queued)
    }
  }
  if (traffic.lead && leadReplan) {
    rideOn(traffic.lead)
    traffic.lead = leadHome(traffic.lead, layout, now, pace, queued, leadLost)
  }
}

/** The lead's plan up to `now`, or until it is out of the cab it is in, then straight back to its desk. */
function leadHome(
  plan: Office3dRound,
  layout: Office3dLayout,
  now: number,
  pace: string | undefined,
  queued: (floor: number, t: number) => number,
  lost: boolean
): Office3dRound {
  const out = office3dCabOutAt(plan, now)
  let start = out ?? now
  const kept = plan.steps
    .filter((s) => s.start < start)
    .map((s) => (s.start + s.dur > start ? { ...s, dur: start - s.start } : s))
  const leadFloor = Math.max(
    0,
    layout.floors.findIndex((fl) => fl.lead)
  )
  const at = office3dWalkerAt(plan, start)
  const atDesk = at.pose === 'desk'
  // Why a blink: from a floor that is gone, or a desk on a floor no longer the lead's, no walk leads home.
  const blink = lost || (atDesk && Math.round(at.floor) !== leadFloor)
  const p = office3dPlanner(start, Math.round(at.floor), at.at, pace)
  // Out of the cab on a walk of its own, as at any stop: one long eased walk lingers in the doorway.
  if (out !== null && !blink && !p.jump) {
    p.walk(OFFICE3D_EXIT)
    kept.push(...p.steps)
    start = p.t
  }
  const trip = office3dLeadRoundOf({
    layout,
    needs: [],
    visits: [],
    pace,
    start: blink ? start + OFFICE3D_JUMP / 2 : start,
    cab: plan.cab,
    queued,
    from: blink || atDesk ? undefined : { floor: p.level, at: p.here }
  })
  const desk = trip.steps[0]
  if (blink && desk?.kind === 'hold') {
    const spot = { floor: desk.floor, at: desk.at }
    kept.push({ kind: 'jump', from: spot, to: spot, start, dur: OFFICE3D_JUMP / 2 })
  }
  return { steps: [...kept, ...trip.steps], total: Infinity, cab: plan.cab }
}
