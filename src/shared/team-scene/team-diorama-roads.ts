import type { DioramaLayout, DioramaPoint } from './team-diorama-layout'

// Why a road graph apart from the walk grid: the lead keeps to the drawn roads and dock decks, so
// it never cuts across the grass or the water (owner, ORCA-1296).

export type DioramaRoadNet = {
  /** Shortest way along the roads, corners rounded inside the road's width. */
  route: (from: DioramaPoint, to: DioramaPoint) => DioramaPoint[]
  /** The road point nearest `p`: where the lead stands for a stop near it. */
  on: (p: DioramaPoint) => DioramaPoint
  /** The connected road part `p` is on: each island's roads are one, and only boats join them. */
  islandOf: (p: DioramaPoint) => number
}

/** Two figures' half-widths at the diorama's scale: centres closer than this overlap. */
export const DIORAMA_BODY_CLEAR = 1.1

const STEP = 0.5
const JOIN = 0.36

export function dioramaRoadNet(layout: Pick<DioramaLayout, 'roads'>): DioramaRoadNet {
  const nodes: DioramaPoint[] = []
  const adj: [number, number][][] = []
  const add = (p: DioramaPoint): number => {
    const near = nodes.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < JOIN)
    if (near !== -1) {
      return near
    }
    nodes.push(p)
    adj.push([])
    return nodes.length - 1
  }
  const link = (i: number, j: number) => {
    if (i === j) {
      return
    }
    const d = Math.hypot(nodes[i]![0] - nodes[j]![0], nodes[i]![1] - nodes[j]![1])
    adj[i]!.push([j, d])
    adj[j]!.push([i, d])
  }
  for (const { pts } of layout.roads) {
    let prev: number | null = null
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]!,
        b = pts[k + 1]!
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP))
      for (let s = k ? 1 : 0; s <= n; s++) {
        const id = add([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n])
        if (prev !== null) {
          link(prev, id)
        }
        prev = id
      }
    }
  }
  // Connected parts: each island's roads are one part; boats join them.
  const part = new Int32Array(nodes.length).fill(-1)
  let parts = 0
  for (let i = 0; i < nodes.length; i++) {
    if (part[i] !== -1) {
      continue
    }
    const stack = [i]
    part[i] = parts
    while (stack.length) {
      for (const [v] of adj[stack.pop()!]!) {
        if (part[v] === -1) {
          part[v] = parts
          stack.push(v)
        }
      }
    }
    parts++
  }
  const snap = (p: DioramaPoint): number => {
    let best = 0,
      bd = Infinity
    nodes.forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }
  const route = (from: DioramaPoint, to: DioramaPoint): DioramaPoint[] => {
    const s = snap(from),
      g = snap(to)
    if (nodes.length === 0 || part[s] !== part[g]) {
      return [nodes[s] ?? from]
    }
    const dist = new Float32Array(nodes.length).fill(Infinity),
      back = new Int32Array(nodes.length).fill(-1),
      done = new Uint8Array(nodes.length)
    dist[s] = 0
    for (;;) {
      let u = -1,
        best = Infinity
      for (let i = 0; i < nodes.length; i++) {
        if (!done[i] && dist[i]! < best) {
          best = dist[i]!
          u = i
        }
      }
      if (u < 0 || u === g) {
        break
      }
      done[u] = 1
      for (const [v, d] of adj[u]!) {
        if (dist[u]! + d < dist[v]!) {
          dist[v] = dist[u]! + d
          back[v] = u
        }
      }
    }
    const ids: number[] = []
    for (let i = g; i !== -1; i = back[i]!) {
      ids.push(i)
    }
    const pts = ids.toReversed().map((i) => nodes[i]!)
    // A quarter of a 0.5 step cut at each corner stays well inside a 0.75 road.
    const out: DioramaPoint[] = [pts[0]!]
    for (let k = 1; k < pts.length - 1; k++) {
      const [px, pz] = pts[k - 1]!,
        [cx, cz] = pts[k]!,
        [nx, nz] = pts[k + 1]!
      out.push(
        [cx * 0.75 + px * 0.25, cz * 0.75 + pz * 0.25],
        [cx * 0.75 + nx * 0.25, cz * 0.75 + nz * 0.25]
      )
    }
    if (pts.length > 1) {
      out.push(pts.at(-1)!)
    }
    return out
  }
  return { route, on: (p) => nodes[snap(p)] ?? p, islandOf: (p) => part[snap(p)] ?? -1 }
}

const toSegment = (p: DioramaPoint, a: DioramaPoint, b: DioramaPoint): number => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1]
  const u = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1))
  )
  return Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dz * u))
}

/**
 * Where a member stands, pulled from `at` toward its plot's middle until it is a body clear of
 * every road: the lead walks the roads, and walked through members standing on one (ORCA-1336).
 */
export function dioramaStandClear(
  layout: Pick<DioramaLayout, 'roads'>,
  at: DioramaPoint,
  plot: DioramaPoint
): DioramaPoint {
  const toRoad = (p: DioramaPoint) =>
    Math.min(
      Infinity,
      ...layout.roads.flatMap(({ pts }) => pts.slice(1).map((b, i) => toSegment(p, pts[i]!, b)))
    )
  const along = (k: number): DioramaPoint => [
    at[0] + (plot[0] - at[0]) * k,
    at[1] + (plot[1] - at[1]) * k
  ]
  if (toRoad(at) >= DIORAMA_BODY_CLEAR) {
    return at
  }
  let lo = 0,
    hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (toRoad(along(mid)) >= DIORAMA_BODY_CLEAR) {
      hi = mid
    } else {
      lo = mid
    }
  }
  return along(hi)
}
