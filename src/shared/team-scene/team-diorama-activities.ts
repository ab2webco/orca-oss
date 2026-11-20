import type { DioramaPlotView } from './team-diorama-actions'
import type { DioramaLayout, DioramaPoint } from './team-diorama-layout'

// Why spots apart from plots: a free member leaves its build to fish, farm or chop, and a resting
// one sits at the camp fire; its plot keeps the build it reached (ORCA-1296).

export type DioramaSpot = {
  key: string
  kind: 'fish' | 'farm' | 'chop' | 'rest'
  at: DioramaPoint
  /** What it faces: the water, the log, the fire. */
  face: DioramaPoint
  /** A farmer walks this loop round the field; the phase keeps two farmers apart. */
  loop?: DioramaPoint[]
  phase?: number
}

export const DIORAMA_FARM = { x: -10.3, z: 5.3, hw: 1.7, hd: 1.3 }
export const DIORAMA_FIRE: DioramaPoint = [-6.2, 4]
export const DIORAMA_LOGS: DioramaPoint = [-6.2, 2.3]
const HOME_FISH: DioramaPoint[] = [
  [-4.6, 9.7],
  [-2.4, 9.7],
  [3.6, 9.7]
]
const HOME_CHOP: DioramaPoint[] = [
  [-7.6, 1.6],
  [-4.8, 1.6]
]
const FIELD_LOOP: DioramaPoint[] = [
  [DIORAMA_FARM.x - DIORAMA_FARM.hw - 0.1, DIORAMA_FARM.z + DIORAMA_FARM.hd + 0.45],
  [DIORAMA_FARM.x + DIORAMA_FARM.hw + 0.1, DIORAMA_FARM.z + DIORAMA_FARM.hd + 0.45],
  [DIORAMA_FARM.x + DIORAMA_FARM.hw + 0.5, DIORAMA_FARM.z - DIORAMA_FARM.hd - 0.2],
  [DIORAMA_FARM.x - DIORAMA_FARM.hw - 0.5, DIORAMA_FARM.z - DIORAMA_FARM.hd - 0.5]
]

/**
 * Where each free or resting member goes: home ones to the docks, the field, the wood pile or
 * round the fire; a free member on another machine fishes off its own island. A member past
 * the spots there are stays at its plot.
 */
export function dioramaActivitySpotsOf(
  layout: DioramaLayout,
  views: ReadonlyMap<string, DioramaPlotView>
): DioramaSpot[] {
  const spots: DioramaSpot[] = []
  const used = { fish: 0, chop: 0, farm: 0, rest: 0 }
  const islandFishing = new Set<string>()
  // Why the overflow too: a free or resting member needs no plot to fish or sit by the fire.
  const home = layout.islands.find((island) => island.home)
  const members = layout.islands.flatMap((island) =>
    island.plots.flatMap((plot) => (plot.key ? [{ key: plot.key, island }] : []))
  )
  if (home) {
    members.push(...layout.overflow.map((key) => ({ key, island: home })))
  }
  for (const { key, island } of members) {
    const view = views.get(key)
    if (!view) {
      continue
    }
    if (view.action === 'rest') {
      const a = (used.rest++ * Math.PI * 2) / 5 + 0.4
      const at: DioramaPoint = [
        DIORAMA_FIRE[0] + Math.cos(a) * 1,
        DIORAMA_FIRE[1] + Math.sin(a) * 1
      ]
      spots.push({ key, kind: 'rest', at, face: DIORAMA_FIRE })
      continue
    }
    if (view.action !== 'idle' || !view.play) {
      continue
    }
    if (!island.home) {
      // One fisher per other island, off its bottom edge, facing the open water.
      if (islandFishing.has(island.key)) {
        continue
      }
      islandFishing.add(island.key)
      const at: DioramaPoint = [island.rect.x - 1, island.rect.z + island.rect.hd + 1.25]
      spots.push({ key, kind: 'fish', at, face: [at[0], at[1] + 3] })
      continue
    }
    if (view.play === 'fish' && used.fish < HOME_FISH.length) {
      const at = HOME_FISH[used.fish++]!
      spots.push({ key, kind: 'fish', at, face: [at[0], at[1] + 3] })
    } else if (view.play === 'chop' && used.chop < HOME_CHOP.length) {
      spots.push({ key, kind: 'chop', at: HOME_CHOP[used.chop++]!, face: DIORAMA_LOGS })
    } else if (view.play === 'farm' && used.farm < 2) {
      spots.push({
        key: key,
        kind: 'farm',
        at: FIELD_LOOP[0]!,
        face: FIELD_LOOP[1]!,
        loop: FIELD_LOOP,
        phase: used.farm++ * 0.5
      })
    }
  }
  return spots
}
