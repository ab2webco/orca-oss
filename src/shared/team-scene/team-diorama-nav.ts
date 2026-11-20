import type { DioramaBlock, DioramaLayout, DioramaPoint } from './team-diorama-layout'

// Why grids: walkers go round every prop, and boats round every island, on paths found by A*.

export type DioramaPath = (from: DioramaPoint, to: DioramaPoint) => DioramaPoint[]
export type DioramaGrid = {
  path: DioramaPath
  spot: (p: DioramaPoint) => DioramaPoint
  free: (p: DioramaPoint) => boolean
}

const AGENT = 0.3
const INLAND = 0.4
const SHORE = 0.9

const inBlock = (x: number, z: number, b: DioramaBlock, pad: number): boolean =>
  'r' in b
    ? Math.hypot(x - b.x, z - b.z) <= b.r + pad
    : Math.abs(x - b.x) <= b.hw + pad && Math.abs(z - b.z) <= b.hd + pad

function gridOf(
  cell: number,
  margin: number,
  rects: DioramaLayout['islands'],
  ok: (x: number, z: number) => boolean
): DioramaGrid {
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity
  for (const { rect: r } of rects) {
    x0 = Math.min(x0, r.x - r.hw)
    x1 = Math.max(x1, r.x + r.hw)
    z0 = Math.min(z0, r.z - r.hd)
    z1 = Math.max(z1, r.z + r.hd)
  }
  x0 -= margin
  x1 += margin
  z0 -= margin
  z1 += margin
  const W = Math.ceil((x1 - x0) / cell) + 1,
    H = Math.ceil((z1 - z0) / cell) + 1
  const cx = (i: number) => x0 + (i + 0.5) * cell,
    cz = (j: number) => z0 + (j + 0.5) * cell
  const open = new Uint8Array(W * H)
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      open[j * W + i] = ok(cx(i), cz(j)) ? 1 : 0
    }
  }
  const clampI = (v: number, n: number) => Math.max(0, Math.min(n - 1, v))
  const cellOf = (x: number, z: number): [number, number] => [
    clampI(Math.floor((x - x0) / cell), W),
    clampI(Math.floor((z - z0) / cell), H)
  ]
  const isOpen = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < W && j < H && open[j * W + i] === 1
  const nearest = (x: number, z: number): [number, number] => {
    const [ci, cj] = cellOf(x, z)
    if (isOpen(ci, cj)) {
      return [ci, cj]
    }
    for (let r = 1; r < 60; r++) {
      let best: [number, number] | null = null,
        bd = Infinity
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !isOpen(ci + di, cj + dj)) {
            continue
          }
          const d = di * di + dj * dj
          if (d < bd) {
            bd = d
            best = [ci + di, cj + dj]
          }
        }
      }
      if (best) {
        return best
      }
    }
    return [ci, cj]
  }
  const sight = (a: DioramaPoint, b: DioramaPoint): boolean => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5))
    for (let k = 0; k <= n; k++) {
      const [i, j] = cellOf(
        a[0] + ((b[0] - a[0]) * k) / Math.max(1, n),
        a[1] + ((b[1] - a[1]) * k) / Math.max(1, n)
      )
      if (!isOpen(i, j)) {
        return false
      }
    }
    return true
  }
  const astar = (s: [number, number], g: [number, number]): DioramaPoint[] | null => {
    const N = W * H,
      cost = new Float32Array(N).fill(Infinity),
      from = new Int32Array(N).fill(-1),
      done = new Uint8Array(N)
    const heap: [number, number][] = []
    const push = (f: number, id: number) => {
      heap.push([f, id])
      for (let k = heap.length - 1; k > 0; ) {
        const p = (k - 1) >> 1
        if (heap[p]![0] <= heap[k]![0]) {
          break
        }
        ;[heap[p], heap[k]] = [heap[k]!, heap[p]!]
        k = p
      }
    }
    const pop = (): [number, number] => {
      const top = heap[0]!,
        last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        for (let k = 0; ; ) {
          const l = 2 * k + 1,
            r = l + 1
          let m = k
          if (l < heap.length && heap[l]![0] < heap[m]![0]) {
            m = l
          }
          if (r < heap.length && heap[r]![0] < heap[m]![0]) {
            m = r
          }
          if (m === k) {
            break
          }
          ;[heap[m], heap[k]] = [heap[k]!, heap[m]!]
          k = m
        }
      }
      return top
    }
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - g[0]),
        dz = Math.abs(j - g[1])
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz)
    }
    const sid = s[1] * W + s[0],
      gid = g[1] * W + g[0]
    cost[sid] = 0
    push(h(s[0], s[1]), sid)
    while (heap.length) {
      const [, id] = pop()
      if (done[id]) {
        continue
      }
      done[id] = 1
      if (id === gid) {
        break
      }
      const i = id % W,
        j = (id / W) | 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if ((!di && !dj) || !isOpen(i + di, j + dj)) {
            continue
          }
          // Why both sides open: a diagonal must not squeeze between two blocked corners.
          if (di && dj && (!isOpen(i + di, j) || !isOpen(i, j + dj))) {
            continue
          }
          const nid = (j + dj) * W + i + di,
            next = cost[id]! + (di && dj ? 1.414 : 1)
          if (next < cost[nid]!) {
            cost[nid] = next
            from[nid] = id
            push(next + h(i + di, j + dj), nid)
          }
        }
      }
    }
    if (from[gid] === -1 && gid !== sid) {
      return null
    }
    const out: DioramaPoint[] = []
    for (let id = gid; id !== -1; id = from[id]!) {
      out.push([cx(id % W), cz((id / W) | 0)])
    }
    return out.toReversed()
  }
  const path: DioramaPath = (a, b) => {
    const s = nearest(a[0], a[1]),
      g = nearest(b[0], b[1])
    const cells = astar(s, g)
    if (!cells) {
      return [[cx(s[0]), cz(s[1])]]
    }
    // Pull the path tight, then round its corners while every piece still has a clear line.
    const pulled: DioramaPoint[] = [cells[0]!]
    for (let k = 0; k < cells.length - 1; ) {
      let j = cells.length - 1
      while (j > k + 1 && !sight(cells[k]!, cells[j]!)) {
        j--
      }
      pulled.push(cells[j]!)
      k = j
    }
    let round = pulled
    for (let it = 0; it < 2; it++) {
      const next: DioramaPoint[] = [round[0]!]
      for (let q = 0; q < round.length - 1; q++) {
        const [ax, az] = round[q]!,
          [bx, bz] = round[q + 1]!
        next.push(
          [ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25],
          [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]
        )
      }
      next.push(round.at(-1)!)
      if (!next.every((p, q) => q === 0 || sight(next[q - 1]!, p))) {
        break
      }
      round = next
    }
    return round
  }
  const spot = (p: DioramaPoint): DioramaPoint => {
    const [i, j] = nearest(p[0], p[1])
    return [cx(i), cz(j)]
  }
  const free = (p: DioramaPoint): boolean => {
    const [i, j] = cellOf(p[0], p[1])
    return isOpen(i, j)
  }
  return { path, spot, free }
}

/** Land walkers: inside an island, clear of every block by a figure's width. */
export function dioramaWalkGrid(
  layout: DioramaLayout,
  extra: readonly DioramaBlock[] = []
): DioramaGrid {
  const blocks = [...layout.blocks, ...extra]
  return gridOf(
    0.2,
    0,
    layout.islands,
    (x, z) =>
      layout.islands.some(
        ({ rect: r }) => Math.abs(x - r.x) <= r.hw - INLAND && Math.abs(z - r.z) <= r.hd - INLAND
      ) && !blocks.some((b) => inBlock(x, z, b, AGENT))
  )
}

/** Boats: open water only, clear of every island's shore. */
export function dioramaWaterGrid(layout: DioramaLayout): DioramaGrid {
  return gridOf(
    0.35,
    6,
    layout.islands,
    (x, z) =>
      !layout.islands.some(
        ({ rect: r }) => Math.abs(x - r.x) <= r.hw + SHORE && Math.abs(z - r.z) <= r.hd + SHORE
      )
  )
}

/** Cumulative lengths of a polyline, for walking it at a steady speed. */
export const polyLengths = (pts: readonly DioramaPoint[]): number[] => {
  const cum = [0]
  for (let k = 1; k < pts.length; k++) {
    cum.push(cum[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]))
  }
  return cum
}

/** The point at distance `d` along a polyline, and the heading there. */
export function polyAt(
  pts: readonly DioramaPoint[],
  cum: readonly number[],
  d: number
): { at: DioramaPoint; heading: DioramaPoint } {
  if (pts.length < 2) {
    return { at: pts[0] ?? [0, 0], heading: [0, 1] }
  }
  let k = 1
  while (k < cum.length - 1 && cum[k]! < d) {
    k++
  }
  const a = pts[k - 1]!,
    b = pts[k]!,
    seg = cum[k]! - cum[k - 1]! || 1
  const f = Math.min(1, Math.max(0, (d - cum[k - 1]!) / seg))
  return {
    at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    heading: [b[0] - a[0], b[1] - a[1]]
  }
}
