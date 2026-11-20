import {
  DIORAMA_GATE,
  type DioramaIsland,
  type DioramaLayout,
  type DioramaPoint
} from './team-diorama-layout'
import { polyAt, polyLengths, type DioramaGrid } from './team-diorama-nav'
import type { DioramaRoadNet } from './team-diorama-roads'

// Why a plan, not a simulation: the lead's whole round is laid out once per read of the team, so
// any moment of it is a pure lookup and reduced motion can show one still frame of it.

/** How the lead gets about: walking like a person, 2.5 times faster, or sent by the court mage. */
export type DioramaPace = 'normal' | 'fast' | 'direct'

/** What a pace does to any scene's walkers: walk speed, how long a word lasts, and whether a trip is
 * a jump. An unknown pace, from a newer client's setting, walks at normal. */
export type DioramaPaceFactors = { speed: number; holdScale: number; jump: boolean }

export const dioramaPaceOf = (pace: string | undefined): DioramaPaceFactors => ({
  speed: pace === 'fast' ? 2.5 : 1,
  holdScale: pace === 'fast' || pace === 'direct' ? 0.6 : 1,
  jump: pace === 'direct'
})

export type DioramaLeadStep =
  | { kind: 'walk'; pts: DioramaPoint[]; cum: number[]; start: number; dur: number }
  | { kind: 'row'; column: number; pts: DioramaPoint[]; cum: number[]; start: number; dur: number }
  | { kind: 'jump'; from: DioramaPoint; to: DioramaPoint; start: number; dur: number }
  | {
      kind: 'hold'
      at: DioramaPoint
      face: DioramaPoint | null
      pose: 'talk' | 'idle'
      start: number
      dur: number
    }

export type DioramaLeadRound = { steps: DioramaLeadStep[]; total: number }

/** Where a member stands at its plot, and the road point the lead talks to it from. */
export const dioramaStandOf = (plot: { x: number; z: number }): DioramaPoint => [
  plot.x + 1.55,
  plot.z + 1.2
]

const WALK = 1.8
const ROW = 1.5
const JUMP = 1.6
const TALK = 3.5
const TALK_APART = 1.3
const TALK_FROM: DioramaPoint[] = [
  [0, 1.2],
  [0, 2],
  [1.4, 0],
  [-1.4, 0],
  [0, -1.4]
]
const HOME_PAUSE = 3

/**
 * The lead's round: the members who need the user first, then every island with a member worth a
 * word, each in one boat trip, then home to the gate. Idle members and unreachable machines get no
 * visit. Every walk keeps to the roads; only a row crosses water.
 */
export function dioramaLeadRoundOf(args: {
  layout: DioramaLayout
  roads: DioramaRoadNet
  water: DioramaGrid
  /** Member keys that need the user, in the order the Team model lists them. */
  needs: readonly string[]
  /** Member keys the lead stops by on its round: working, waiting or broken ones. */
  visits: readonly string[]
  pace: DioramaPace
  /** Where each member stands as its state draws it; a plot's default stand otherwise. */
  stands?: ReadonlyMap<string, DioramaPoint>
}): DioramaLeadRound {
  const { layout, roads, water, pace } = args
  const { speed, holdScale, jump } = dioramaPaceOf(pace)
  const steps: DioramaLeadStep[] = []
  let t = 0
  const push = (step: DioramaLeadStep) => {
    steps.push(step)
    t += step.dur
  }
  const walk = (from: DioramaPoint, to: DioramaPoint): DioramaPoint => {
    if (jump) {
      push({ kind: 'jump', from, to, start: t, dur: JUMP })
      return to
    }
    const pts = roads.route(from, to)
    const cum = polyLengths(pts)
    push({ kind: 'walk', pts, cum, start: t, dur: cum.at(-1)! / (WALK * speed) + 0.5 / speed })
    return pts.at(-1)!
  }
  const row = (column: number, from: DioramaPoint, to: DioramaPoint) => {
    const pts = water.path(from, to)
    const cum = polyLengths(pts)
    push({
      kind: 'row',
      column,
      pts,
      cum,
      start: t,
      dur: cum.at(-1)! / (ROW * speed) + 1.2 / speed
    })
  }
  const talk = (at: DioramaPoint, face: DioramaPoint) =>
    push({ kind: 'hold', at, face, pose: 'talk', start: t, dur: TALK * holdScale })
  const placeOf = (key: string): { island: DioramaIsland; stand: DioramaPoint } | null => {
    for (const island of layout.islands) {
      const plot = island.plots.find((p) => p.key === key)
      if (plot) {
        return { island, stand: args.stands?.get(key) ?? dioramaStandOf(plot) }
      }
    }
    return null
  }
  // Why apart: the lead talks from the road a step away, never inside the member it talks to.
  const talkSpotOf = (stand: DioramaPoint): DioramaPoint => {
    const spots = TALK_FROM.map(([dx, dz]) => roads.on([stand[0] + dx, stand[1] + dz]))
    const apart = spots.find((p) => Math.hypot(p[0] - stand[0], p[1] - stand[1]) >= TALK_APART)
    return apart ?? spots[0]!
  }

  // One trip per island: every member there in one boat ride, needs-you ones first.
  const trips = new Map<DioramaIsland, DioramaPoint[]>()
  for (const key of [...args.needs, ...args.visits.filter((k) => !args.needs.includes(k))]) {
    const place = placeOf(key)
    if (!place || !place.island.reachable) {
      continue
    }
    trips.set(place.island, [...(trips.get(place.island) ?? []), place.stand])
  }
  const gate = roads.on(DIORAMA_GATE)
  let here = gate
  for (const [island, stands] of trips) {
    if (island.home) {
      for (const stand of stands) {
        here = walk(here, talkSpotOf(stand))
        talk(here, stand)
      }
      continue
    }
    const dock = layout.homeDocks[island.column]
    if (!dock || !island.dock) {
      continue
    }
    if (jump) {
      for (const stand of stands) {
        here = walk(here, talkSpotOf(stand))
        talk(here, stand)
      }
      continue
    }
    here = walk(here, dock.end)
    row(island.column, dock.boat, island.dock.boat)
    here = island.dock.end
    for (const stand of stands) {
      here = walk(here, talkSpotOf(stand))
      talk(here, stand)
    }
    walk(here, island.dock.end)
    row(island.column, island.dock.boat, dock.boat)
    here = dock.end
  }
  if (here !== gate) {
    here = walk(here, gate)
  }
  push({ kind: 'hold', at: here, face: null, pose: 'idle', start: t, dur: HOME_PAUSE })
  return { steps, total: t }
}

/** The step the round is on at `t` seconds into it, looping. */
export function dioramaLeadStepAt(round: DioramaLeadRound, t: number): DioramaLeadStep {
  const tt = round.total > 0 ? ((t % round.total) + round.total) % round.total : 0
  return round.steps.find((s) => tt >= s.start && tt < s.start + s.dur) ?? round.steps.at(-1)!
}

const easeInOut = (x: number): number => {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

/** Where the lead is at `t`, its heading and pose; `blink` shrinks it while the mage sends it. */
export function dioramaLeadAt(
  round: DioramaLeadRound,
  t: number
): {
  at: DioramaPoint
  heading: DioramaPoint | null
  pose: 'walk' | 'sit' | 'talk' | 'idle'
  blink: number
  column: number | null
} {
  const s = dioramaLeadStepAt(round, t)
  const k = s.dur > 0 ? ((((t % round.total) + round.total) % round.total) - s.start) / s.dur : 1
  if (s.kind === 'walk' || s.kind === 'row') {
    const p = polyAt(s.pts, s.cum, easeInOut(k) * s.cum.at(-1)!)
    return {
      at: p.at,
      heading: p.heading,
      pose: s.kind === 'row' ? 'sit' : 'walk',
      blink: 1,
      column: s.kind === 'row' ? s.column : null
    }
  }
  if (s.kind === 'jump') {
    return {
      at: k < 0.5 ? s.from : s.to,
      heading: null,
      pose: 'idle',
      blink: Math.max(0.02, Math.abs(1 - 2 * k)),
      column: null
    }
  }
  return {
    at: s.at,
    heading: s.face ? [s.face[0] - s.at[0], s.face[1] - s.at[1]] : null,
    pose: s.pose,
    blink: 1,
    column: null
  }
}

/** Where a column's boat is at `t`: moored where its last trip in the round left it. */
export function dioramaBoatAt(
  round: DioramaLeadRound,
  column: number,
  home: DioramaPoint,
  t: number
): { at: DioramaPoint; heading: DioramaPoint | null; moving: boolean } {
  const tt = round.total > 0 ? ((t % round.total) + round.total) % round.total : 0
  let out: { at: DioramaPoint; heading: DioramaPoint | null; moving: boolean } = {
    at: home,
    heading: null,
    moving: false
  }
  for (const s of round.steps) {
    if (s.kind !== 'row' || s.column !== column || s.start > tt) {
      continue
    }
    if (tt < s.start + s.dur) {
      const p = polyAt(s.pts, s.cum, easeInOut((tt - s.start) / s.dur) * s.cum.at(-1)!)
      return { at: p.at, heading: p.heading, moving: true }
    }
    const n = s.pts.length
    out = {
      at: s.pts[n - 1]!,
      heading:
        n > 1 ? [s.pts[n - 1]![0] - s.pts[n - 2]![0], s.pts[n - 1]![1] - s.pts[n - 2]![1]] : null,
      moving: false
    }
  }
  return out
}

/** The jump the court mage is sending the lead on at `t`, and how far along it is; else null. */
export function dioramaLeadJumpAt(
  round: DioramaLeadRound,
  t: number
): { from: DioramaPoint; to: DioramaPoint; k: number } | null {
  const s = dioramaLeadStepAt(round, t)
  if (s.kind !== 'jump' || s.dur <= 0) {
    return null
  }
  const tt = ((t % round.total) + round.total) % round.total
  return { from: s.from, to: s.to, k: Math.min(1, Math.max(0, (tt - s.start) / s.dur)) }
}
