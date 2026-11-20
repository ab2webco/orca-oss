import type { TeamSceneFloor } from './team-scene-floors'

// Why one module: the Figures diorama (ORCA-1296) places every island, plot, road, dock and prop
// here, so the renderer only draws and the walkers' maps are tested without WebGL.

/** World units: x to the right, z toward the viewer, the ground's top at y 0. */
export type DioramaPoint = [number, number]
export type DioramaRect = { x: number; z: number; hw: number; hd: number }
/** A footprint walkers keep clear of: a circle or a rectangle. */
export type DioramaBlock = { x: number; z: number; r: number } | ({ kind: 'rect' } & DioramaRect)
export type DioramaPlot = { x: number; z: number; key: string | null; taken: boolean }
export type DioramaDock = { end: DioramaPoint; boat: DioramaPoint }
export type DioramaRoad = { pts: DioramaPoint[]; paved: boolean }

export type DioramaIsland = {
  key: string
  name: string
  home: boolean
  reachable: boolean
  rect: DioramaRect
  plots: DioramaPlot[]
  /** Its dock on the side facing home; the home island has one per column instead. */
  dock: DioramaDock | null
  column: number
}

/** A machine as the diorama needs it, read from the Office floors (cap, running, reach). */
export type DioramaMachine = {
  key: string
  name: string
  home: boolean
  reachable: boolean
  members: string[]
  cap: number | null
  taken: number
}

export type DioramaOrder = { islands: (string | null)[]; plots: Record<string, (string | null)[]> }

export type DioramaLayout = {
  islands: DioramaIsland[]
  homeDocks: Record<number, DioramaDock>
  roads: DioramaRoad[]
  blocks: DioramaBlock[]
  /** Members no island has a plot for; the panel's list still shows them. */
  overflow: string[]
  order: DioramaOrder
}

export const DIORAMA_HOME: DioramaRect = { x: -1.75, z: 1, hw: 11.25, hd: 7.5 }
export const DIORAMA_HOME_PLOTS: DioramaPoint[] = [
  [0.4, -1.6],
  [4.2, -1.6],
  [8, -1.6],
  [0.4, 2.6],
  [4.2, 2.6],
  [8, 2.6]
]
export const DIORAMA_KEEP: DioramaPoint = [-6, -2.4]
export const DIORAMA_GATE: DioramaPoint = [-5, 0.4]
export const DIORAMA_LANE_Z = 5.4
const HOME_DOCK_Z = 8.3
const ISLAND_GAP = 5.5
const FIRST_ROW_TOP = 15.75
const PLOT_PITCH: DioramaPoint = [3.3, 3.6]
const MAX_ISLAND_PLOTS = 6

/** The home island's fixed props, each with the footprint walkers keep clear of. */
export const DIORAMA_HOME_BLOCKS: DioramaBlock[] = [
  { kind: 'rect', x: DIORAMA_KEEP[0], z: DIORAMA_KEEP[1], hw: 1.75, hd: 1.75 },
  { x: -0.9, z: -5.3, r: 0.8 }, // the advisor's tower
  { x: -7.6, z: 3.3, r: 0.85 }, // the camp's tent
  { x: -6.2, z: 4, r: 0.45 }, // its fire
  { kind: 'rect', x: -6.2, z: 2.3, hw: 0.5, hd: 0.3 }, // the log pile
  { kind: 'rect', x: -10.3, z: 5.3, hw: 1.7, hd: 1.3 } // the farm
]

const keyOfFloor = (floor: TeamSceneFloor): string => floor.key

/** Each floor as a machine: its members' pane keys, cap and the seats other sessions hold. */
export function teamDioramaMachinesOf(floors: readonly TeamSceneFloor[]): DioramaMachine[] {
  return floors.map((floor) => ({
    key: keyOfFloor(floor),
    name: floor.host.kind === 'remote' ? floor.host.name : '',
    home: floor.lead,
    reachable: floor.reachable,
    members: floor.members.map((m) => m.paneKey),
    cap: floor.cap,
    taken: floor.taken
  }))
}

/** Keeps each key where it was; a newcomer takes the first hole, else the end. */
export function stableOrderOf(
  keys: readonly string[],
  previous: readonly (string | null)[]
): (string | null)[] {
  const present = new Set(keys)
  const order = previous.map((key) => (key !== null && present.has(key) ? key : null))
  for (const key of keys) {
    if (order.includes(key)) {
      continue
    }
    const hole = order.indexOf(null)
    if (hole === -1) {
      order.push(key)
    } else {
      order[hole] = key
    }
  }
  while (order.length > 0 && order.at(-1) === null) {
    order.pop()
  }
  return order
}

/** The order cut to `slots` plots: who falls past moves into a free plot, else is returned. */
function fitOrder(order: (string | null)[], slots: number): string[] {
  const left: string[] = []
  for (const key of order.splice(slots)) {
    const hole = order.indexOf(null)
    if (key !== null && hole === -1) {
      left.push(key)
    } else if (key !== null) {
      order[hole] = key
    }
  }
  return left
}

/** Plots an island holds: its cap, else its members, and the seats other sessions hold. */
export const islandSlotsOf = (m: DioramaMachine): number =>
  Math.max(1, Math.min(MAX_ISLAND_PLOTS, Math.max(m.cap ?? 0, m.members.length + m.taken)))

function plotsOf(
  order: readonly (string | null)[],
  spots: DioramaPoint[],
  taken: number
): DioramaPlot[] {
  let left = taken
  return spots.map(([x, z], i) => {
    const key = order[i] ?? null
    const isTaken = key === null && left > 0
    if (isTaken) {
      left -= 1
    }
    return { x, z, key, taken: isTaken }
  })
}

function islandRoads(rect: DioramaRect): DioramaRoad[] {
  const top = rect.z - rect.hd,
    bottom = rect.z + rect.hd
  const xL = rect.x - rect.hw + 0.75,
    xR = rect.x + rect.hw - 0.75
  const back = top + 0.7,
    front = bottom - 0.8
  return [
    {
      pts: [
        [rect.x, top + 0.25],
        [rect.x, back]
      ],
      paved: true
    },
    {
      pts: [
        [xL, back],
        [xR, back],
        [xR, front],
        [xL, front]
      ],
      paved: true
    },
    {
      pts: [
        [rect.x, top + 0.25],
        [rect.x, top - 1.15]
      ],
      paved: false
    }
  ]
}

/**
 * The world for the team's machines: the lead's home island, then one island per other machine
 * in fixed slots under it, so a machine that joins never moves the islands already there.
 */
export function teamDioramaLayoutOf(
  machines: readonly DioramaMachine[],
  previous: DioramaOrder = { islands: [], plots: {} },
  narrow = false
): DioramaLayout {
  const cols = narrow ? 2 : 3
  const xs = narrow ? [-6.5, 9.5] : [-14, 1.5, 17]
  const homeDockX = narrow ? [-2.5, 5.5] : [-7, 0.5, 8.5]
  const home = machines.find((m) => m.home) ?? null
  const others = machines.filter((m) => !m.home)
  const order: DioramaOrder = {
    islands: stableOrderOf(
      others.map((m) => m.key),
      previous.islands
    ),
    plots: {}
  }
  const roads: DioramaRoad[] = [
    { pts: [DIORAMA_GATE, [-3.2, 0.5], [9, 0.5]], paved: true },
    {
      pts: [
        [-3.2, 0.5],
        [-3.2, DIORAMA_LANE_Z]
      ],
      paved: true
    },
    {
      pts: [
        [-7.2, DIORAMA_LANE_Z],
        [9.2, DIORAMA_LANE_Z]
      ],
      paved: true
    }
  ]
  const blocks: DioramaBlock[] = [...DIORAMA_HOME_BLOCKS]
  const islands: DioramaIsland[] = []
  const overflow: string[] = []
  if (home) {
    const homeOrder = stableOrderOf(home.members, previous.plots[home.key] ?? [])
    overflow.push(...fitOrder(homeOrder, DIORAMA_HOME_PLOTS.length))
    order.plots[home.key] = homeOrder
    islands.push({
      key: home.key,
      name: home.name,
      home: true,
      reachable: true,
      rect: DIORAMA_HOME,
      plots: plotsOf(order.plots[home.key]!, DIORAMA_HOME_PLOTS, home.taken),
      dock: null,
      column: -1
    })
  }
  // Rows sit under the home island; a row is as deep as its deepest island.
  const rowTop: number[] = []
  const sizes = order.islands.map((key) => {
    const m = others.find((one) => one.key === key)
    if (!m) {
      return null
    }
    const slots = islandSlotsOf(m)
    const across = Math.min(slots, 3),
      rows = Math.ceil(slots / 3)
    return {
      m,
      slots,
      across,
      rows,
      hw: (6.5 + (across - 1) * PLOT_PITCH[0]) / 2,
      hd: (6.5 + (rows - 1) * PLOT_PITCH[1]) / 2
    }
  })
  sizes.forEach((size, k) => {
    const row = Math.floor(k / cols)
    if (rowTop[row] === undefined) {
      const above = sizes
        .slice((row - 1) * cols, row * cols)
        .reduce((d, s) => Math.max(d, s ? s.hd * 2 : 0), 0)
      rowTop[row] = row === 0 ? FIRST_ROW_TOP : rowTop[row - 1]! + Math.max(above, 6.5) + ISLAND_GAP
    }
    if (!size) {
      return
    }
    const { m, slots, across, rows, hw, hd } = size
    const c = k % cols
    const rect = { x: xs[c]!, z: rowTop[row]! + hd, hw, hd }
    const spots: DioramaPoint[] = Array.from({ length: slots }, (_, j) => [
      rect.x - (across - 1) * (PLOT_PITCH[0] / 2) + (j % 3) * PLOT_PITCH[0],
      rect.z - 0.3 - (rows - 1) * (PLOT_PITCH[1] / 2) + Math.floor(j / 3) * PLOT_PITCH[1]
    ])
    const plotOrder = stableOrderOf(m.members, previous.plots[m.key] ?? [])
    overflow.push(...fitOrder(plotOrder, slots))
    order.plots[m.key] = plotOrder
    const top = rect.z - hd
    islands.push({
      key: m.key,
      name: m.name,
      home: false,
      reachable: m.reachable,
      rect,
      plots: plotsOf(order.plots[m.key]!, spots, m.taken),
      dock: { end: [rect.x, top - 1.15], boat: [rect.x, top - 2.05] },
      column: c
    })
    roads.push(...islandRoads(rect))
  })
  const homeDocks: Record<number, DioramaDock> = {}
  for (const island of islands) {
    if (island.home || island.column in homeDocks) {
      continue
    }
    const x = homeDockX[island.column]!
    roads.push({
      pts: [
        [x, DIORAMA_LANE_Z],
        [x, HOME_DOCK_Z]
      ],
      paved: true
    })
    roads.push({
      pts: [
        [x, HOME_DOCK_Z],
        [x, HOME_DOCK_Z + 1.4]
      ],
      paved: false
    })
    homeDocks[island.column] = { end: [x, HOME_DOCK_Z + 1.4], boat: [x, HOME_DOCK_Z + 2.2] }
  }
  for (const island of islands) {
    for (const plot of island.plots) {
      if (plot.key || plot.taken) {
        blocks.push({ kind: 'rect', x: plot.x, z: plot.z, hw: 1, hd: 1 })
      }
    }
  }
  return { islands, homeDocks, roads, blocks, overflow, order }
}
