import type { Office3dCab } from './team-office3d-elevator'
import { office3dLobbyOf, type Office3dLayout } from './team-office3d-layout'
import {
  office3dPlaceOf,
  office3dWaitOf,
  type Office3dPlace,
  type Office3dWait
} from './team-office3d-places'
import {
  office3dLaneOf,
  office3dPlanner,
  office3dPolyLengthTo,
  office3dQueued,
  type Office3dQueue
} from './team-office3d-planner'
import {
  office3dSeatPose,
  office3dSlotId,
  office3dSlotsOf,
  type Office3dSlot
} from './team-office3d-slots'
import { office3dWalkerAt, type Office3dRound, type Office3dStep } from './team-office3d-walkers'
import type { TeamSceneMemberInput } from './team-scene-types'

const STAGGER = 0.8

// Why waypoints, not a grid: each floor is a corridor, so a member leaves its seat by the way it
// came in, walks a lane of the aisle, and takes the lift with the others (ORCA-1317).

export type Office3dMember = {
  key: string
  place: Office3dPlace
  /** The wait it is in, and where it chose to wait; null while it is not waiting on its PR. */
  waitSince: number | null
  wait: Office3dWait
  slot: Office3dSlot | null
  plan: Office3dRound
  /** Its current trip's steps start here; an interrupted trip is retraced from this step on. */
  tripFrom: number
  leaving: boolean
  /** Whose Office sheet it wears, kept so a leaver walks out in the clothes it sat in. */
  look?: string
}

/** Plans `m`'s trip from where its plan has it at `now` to `to`; null `to` walks out the door. */
function tripTo(
  m: Office3dMember,
  to: Office3dSlot | null,
  layout: Office3dLayout,
  cab: Office3dCab,
  now: number,
  pace: string | undefined,
  queued: (floor: number, t: number) => number
): void {
  const at = office3dWalkerAt(m.plan, now)
  const step = m.plan.steps.find((s) => now >= s.start && now < s.start + s.dur)
  // Mid-ride it rides on; otherwise it starts at once (owner: 'debe volver de una').
  const start = step?.kind === 'ride' ? step.start + step.dur : now
  const from = step?.kind === 'ride' ? office3dWalkerAt(m.plan, start) : at
  const p = office3dPlanner(start, Math.round(from.floor), from.at, pace)
  const kept = m.plan.steps
    .filter((s) => s.start < start)
    .map((s) => (s.start + s.dur > start ? { ...s, dur: start - s.start } : s))
  // Back along the way it came on this floor, so it never cuts through what it walked around.
  if (step?.kind === 'walk') {
    // Only the waypoints it has passed: those of earlier walks, and this walk's up to where it is.
    const walked = (s: Extract<Office3dStep, { kind: 'walk' }>) => {
      if (s !== step) {
        return s.pts.slice(0, -1)
      }
      const along = office3dPolyLengthTo(s, from.at)
      return s.pts.filter((_, i) => s.cum[i]! <= along)
    }
    const trail = m.plan.steps
      .slice(m.tripFrom)
      .filter(
        (s): s is Extract<Office3dStep, { kind: 'walk' }> =>
          s.kind === 'walk' && s.floor === step.floor && s.start <= now
      )
      .flatMap(walked)
    p.walk(...trail.toReversed())
  } else if (
    m.slot &&
    step?.kind !== 'ride' &&
    Math.hypot(from.at[0] - m.slot.at[0], from.at[1] - m.slot.at[1]) < 0.05
  ) {
    p.walk(...m.slot.path.slice(0, -1).toReversed(), [
      m.slot.entry,
      office3dLaneOf(m.slot.entry, to?.entry ?? 0)
    ])
  }
  const L = office3dLobbyOf(layout.floors[0]?.width ?? 0)
  const goal = to ?? {
    kind: 'cafe' as const,
    index: 0,
    floor: 0,
    at: L.door,
    face: L.door,
    entry: L.door[0],
    path: [L.door]
  }
  if (p.jump) {
    p.jumpTo(goal.floor, goal.at)
  } else {
    if (goal.floor !== p.level) {
      p.ride(goal.floor, cab, queued(p.level, p.t))
    }
    const lane = office3dLaneOf(p.here[0], goal.entry)
    p.walk([p.here[0], lane], [goal.entry, lane], ...goal.path)
  }
  if (to) {
    p.hold(office3dSeatPose(to.kind), 1e9, to.face)
  } else {
    p.hold('gone', 1e9, null)
  }
  m.tripFrom = kept.length
  m.plan = { steps: [...kept, ...p.steps], total: Infinity, cab }
  m.slot = to
}

/** The member's wait, chosen once when its PR wait begins and held until it ends. */
function waitOf(m: Office3dMember | undefined, input: TeamSceneMemberInput, now: number) {
  const waiting = office3dPlaceOf(input, 'desk') !== office3dPlaceOf(input, 'cafe')
  if (!waiting) {
    return { waitSince: null, wait: 'desk' as Office3dWait }
  }
  const since = m?.waitSince ?? now
  return {
    waitSince: since,
    wait: m?.waitSince === null || !m ? office3dWaitOf(input.key, String(since)) : m.wait
  }
}

/**
 * One read of the members at `now`: each one's place from its state, a seat for it (a full room
 * keeps it at its desk), and a trip for each whose seat changed. The first read seats everyone.
 */
export function office3dMembersRead(args: {
  members: Map<string, Office3dMember>
  layout: Office3dLayout
  input: readonly TeamSceneMemberInput[]
  cab: Office3dCab
  now: number
  pace: string | undefined
  first: boolean
  /** The call-panel lines, shared with the lead. */
  queue: Office3dQueue
}): void {
  const { members, layout, cab, now, pace } = args
  const slots = office3dSlotsOf(layout)
  const taken = new Set<string>()
  const queued = office3dQueued(args.queue)
  // Who already holds a room seat keeps it while it stays in that room: nobody swaps chairs.
  const want = new Map<string, Office3dSlot | null>()
  const pick = (pool: Office3dSlot[], m: Office3dMember | undefined) => {
    const kept = pool.find((s) => m?.slot && office3dSlotId(s) === office3dSlotId(m.slot))
    if (kept) {
      return kept
    }
    const free = pool.find((s) => !taken.has(office3dSlotId(s)))
    if (free) {
      taken.add(office3dSlotId(free))
    }
    return free ?? null
  }
  const poolOf = (place: Office3dPlace) =>
    place === 'office'
      ? slots.guest
      : place === 'cafe'
        ? slots.cafe
        : place === 'games'
          ? slots.games
          : null
  const placed = args.input.map((input) => {
    const m = members.get(input.key)
    const { waitSince, wait } = waitOf(m, input, now)
    return { input, m, waitSince, wait, place: office3dPlaceOf(input, wait) }
  })
  // Why first: whoever stays in its room keeps its seat, so a newcomer never takes it (ORCA-1319).
  for (const { m, place } of placed) {
    const own = office3dSlotId(m?.slot ?? null)
    if (m?.slot && poolOf(place)?.some((s) => office3dSlotId(s) === own)) {
      taken.add(own)
    }
  }
  for (const { input, m, waitSince, wait, place } of placed) {
    const desk = slots.desks.get(input.key) ?? null
    const pool = poolOf(place)
    const slot = pool ? pick(pool, m) : null
    want.set(input.key, slot ?? (place === 'gone' ? null : desk))
    if (m) {
      Object.assign(m, { place, waitSince, wait })
    } else {
      const target = want.get(input.key)
      const L = office3dLobbyOf(layout.floors[0]?.width ?? 0)
      const home = target ?? { floor: 0, at: L.door, face: L.door }
      const created: Office3dMember = {
        key: input.key,
        look: input.characterKey ?? input.key,
        place,
        waitSince,
        wait,
        slot: null,
        leaving: false,
        tripFrom: 0,
        plan: {
          steps: [
            {
              kind: 'hold',
              floor: args.first ? home.floor : 0,
              at: args.first ? home.at : L.door,
              pose: args.first && target ? office3dSeatPose(target.kind) : 'gone',
              face: home.face,
              start: now,
              dur: 1e9
            }
          ],
          total: Infinity,
          cab
        }
      }
      if (args.first) {
        created.slot = target ?? null
      }
      members.set(input.key, created)
    }
  }
  let leavingNow = 0
  for (const [key, m] of members) {
    const target = want.has(key) ? want.get(key)! : null
    if (!want.has(key)) {
      if (!m.leaving) {
        m.leaving = true
        tripTo(m, null, layout, cab, now, pace, queued)
      } else if (now > m.plan.steps.at(-1)!.start + 5) {
        // Out of the door a while ago: it no longer exists in the building.
        members.delete(key)
      }
      continue
    }
    if (office3dSlotId(target) !== office3dSlotId(m.slot)) {
      m.leaving = false
      // Why one after another: a team let go in one read stood up as one; back to work never waits.
      const delay = target && target.kind !== 'desk' ? STAGGER * leavingNow++ : 0
      tripTo(m, target, layout, cab, now + delay, pace, queued)
    }
  }
}

/** Where member `key` is at `t`, its pose, and the seat it holds once it has arrived. */
export function office3dMemberAt(m: Office3dMember, t: number) {
  const at = office3dWalkerAt(m.plan, t)
  const last = m.plan.steps.at(-1)
  // Why before its first step too: the walker draws it at its last step then, as under reduced
  // motion's still frame, so it holds that seat and the lobby TV sees it playing (ORCA-1336).
  const before = t < (m.plan.steps[0]?.start ?? -Infinity)
  const arrived = last !== undefined && (t >= last.start || before)
  return { ...at, slot: arrived ? m.slot : null }
}
