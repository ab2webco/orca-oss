import { DIORAMA_GATE, type DioramaLayout, type DioramaPoint } from './team-diorama-layout'
import { polyAt, polyLengths, type DioramaGrid } from './team-diorama-nav'
import type { DioramaRoadNet } from './team-diorama-roads'

// Why a plan, not a simulation: the lead's trip is laid out once per read of the team, so any
// moment of it is a pure lookup and reduced motion can show one still frame of it. It never loops:
// the lead moves only for a member who asks and stays with it, as in the 3D Office (ORCA-1336).

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
const TALK_APART = 1.3
const TALK_FROM: DioramaPoint[] = [
  [0, 1.2],
  [0, 2],
  [1.4, 0],
  [-1.4, 0],
  [0, -1.4]
]
/** Before any read: the boat a lead stayed by is already moored at that island. */
const LONG_AGO = -1e6

/** One trip: from the member the lead stood by (null: the gate) to the next (null: home). */
export type DioramaLeadTrip = { from: string | null; to: string | null; start: number }

/**
 * The lead's trip from `trip.from` to `trip.to`, starting at `trip.start`, then standing there for
 * good: talking to the member, or idle at the gate. Every walk keeps to the roads; only a row
 * crosses water, and a remote island is reached through its column's home dock.
 */
export function dioramaLeadRoundOf(args: {
  layout: DioramaLayout
  roads: DioramaRoadNet
  water: DioramaGrid
  trip: DioramaLeadTrip
  pace: DioramaPace
  /** Where each member stands as its state draws it; a plot's default stand otherwise. */
  stands?: ReadonlyMap<string, DioramaPoint>
}): DioramaLeadRound {
  const { layout, roads, water, pace, trip } = args
  const { speed, jump } = dioramaPaceOf(pace)
  const steps: DioramaLeadStep[] = []
  let t = trip.start
  const push = (step: DioramaLeadStep) => {
    steps.push(step)
    t += step.dur
  }
  const walk = (from: DioramaPoint, to: DioramaPoint): DioramaPoint => {
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
  const placeOf = (key: string | null) => {
    for (const island of key === null ? [] : layout.islands) {
      const plot = island.plots.find((p) => p.key === key)
      if (plot) {
        return { island, stand: args.stands?.get(key!) ?? dioramaStandOf(plot) }
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
  const gate = roads.on(DIORAMA_GATE)
  const from = placeOf(trip.from)
  const to = placeOf(trip.to)
  const start = from ? talkSpotOf(from.stand) : gate
  const end = to ? talkSpotOf(to.stand) : gate
  const away = (p: typeof from) => (p && !p.island.home && p.island.dock ? p.island : null)
  const fromIsland = away(from)
  const toIsland = away(to)
  if (fromIsland) {
    const moored = fromIsland.dock!.boat
    steps.push({
      kind: 'row',
      column: fromIsland.column,
      pts: [moored, moored],
      cum: [0, 0],
      start: LONG_AGO,
      dur: 0
    })
  }
  // Until it sets out, the lead stays where the last trip left it.
  steps.push({
    kind: 'hold',
    at: start,
    face: from?.stand ?? null,
    pose: from ? 'talk' : 'idle',
    start: LONG_AGO,
    dur: trip.start - LONG_AGO
  })
  let here = start
  if (jump) {
    push({ kind: 'jump', from: start, to: end, start: t, dur: JUMP })
    here = end
  } else if (fromIsland !== toIsland || fromIsland === null) {
    for (const island of [fromIsland, toIsland]) {
      const dock = island && layout.homeDocks[island.column]
      if (!island || !dock) {
        continue
      }
      const outbound = island === toIsland
      here = walk(here, outbound ? dock.end : island.dock!.end)
      row(
        island.column,
        outbound ? dock.boat : island.dock!.boat,
        outbound ? island.dock!.boat : dock.boat
      )
      here = outbound ? island.dock!.end : dock.end
    }
  }
  if (here !== end) {
    walk(here, end)
  }
  steps.push(
    to
      ? { kind: 'hold', at: end, face: to.stand, pose: 'talk', start: t, dur: Infinity }
      : { kind: 'hold', at: end, face: null, pose: 'idle', start: t, dur: Infinity }
  )
  return { steps, total: Infinity }
}

/** The step the trip is on at `t`: where the lead stood before it, then each step, then its last hold. */
export function dioramaLeadStepAt(round: DioramaLeadRound, t: number): DioramaLeadStep {
  const live = round.steps.filter((s) => s.dur > 0)
  return live.find((s) => t >= s.start && t < s.start + s.dur) ?? live.at(-1)!
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
  const k = Math.min(1, Math.max(0, (t - s.start) / s.dur))
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
  const tt = t
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
  return { from: s.from, to: s.to, k: Math.min(1, Math.max(0, (t - s.start) / s.dur)) }
}
