import * as THREE from 'three'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import {
  DIORAMA_KEEP,
  DIORAMA_LANE_Z,
  type DioramaIsland,
  type DioramaLayout,
  type DioramaPoint
} from '../../../../shared/team-scene/team-diorama-layout'
import { dioramaStandClear } from '../../../../shared/team-scene/team-diorama-roads'
import { dioramaKeep, type DioramaTick } from './team-diorama-buildings'
import { dioramaChip } from './team-diorama-fx'
import { dioramaOffKit, type DioramaKit } from './team-diorama-kit'
import { dioramaPlot, type DioramaPlotStand } from './team-diorama-plots'
import { dioramaIsland, dioramaRoad, dioramaTravelDock, dioramaTree } from './team-diorama-scenery'

// Why every ground surface has its own height, at least 0.02 apart: two faces at one height
// flicker (z-fighting) as the camera moves. Grass tops sit at y 0, roads at 0.03, plots at 0.05,
// the field at 0.06 and dock planks at 0.09 (owner, ORCA-1296).

/** The words the island chips use; without them only remote machines are named. */
export type DioramaWords = { thisMachine: string; offline: string }

export type DioramaWorld = {
  world: THREE.Group
  /** Each member's place on its plot, as its state draws it. */
  stands: Map<string, { at: DioramaPoint; stand: DioramaPlotStand }>
  ticks: DioramaTick[]
}

/** An unreachable machine's island drifts under a slow fog. */
function fog(k: DioramaKit, isl: DioramaIsland, parent: THREE.Object3D): DioramaTick {
  const { x, z, hw } = isl.rect
  const puffs = Array.from({ length: 6 + isl.plots.length * 3 }, () => {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9 + k.rnd() * 0.9, 1),
      k.mat(k.p.fog, { opacity: k.p.fogOpacity, unique: true })
    )
    m.userData.o = [
      (k.rnd() - 0.5) * (hw * 2 - 1),
      0.6 + k.rnd() * 1.6,
      k.rnd() * 6 - 3,
      k.rnd() * 6
    ]
    parent.add(m)
    return m
  })
  return (t) =>
    puffs.forEach((m) => {
      const [ox, oy, oz, ph] = m.userData.o as number[]
      m.position.set(
        x + ox! + Math.sin(t * 0.25 + ph!) * 0.8,
        oy!,
        z + oz! + Math.cos(t * 0.2 + ph!) * 0.6
      )
    })
}

function chipOf(isl: DioramaIsland, words: DioramaWords | undefined): string | null {
  if (isl.home) {
    return words ? words.thisMachine : null
  }
  if (!isl.reachable) {
    return words ? `${isl.name} · ${words.offline}` : isl.name
  }
  return `${isl.name} · ${isl.plots.filter((p) => p.key).length}/${isl.plots.length}`
}

/** The static world: sea, islands, roads, docks, the keep, every plot by its member's state. */
export function dioramaWorld(
  k: DioramaKit,
  layout: DioramaLayout,
  views: ReadonlyMap<string, DioramaPlotView>,
  words?: DioramaWords
): DioramaWorld {
  const world = new THREE.Group()
  const ticks: DioramaTick[] = []
  const stands: DioramaWorld['stands'] = new Map()
  const sea = k.mesh(
    new THREE.PlaneGeometry(600, 600),
    k.mat(k.p.sea, { rough: 0.35, metal: 0.05 }),
    0,
    -0.95,
    0,
    world,
    false
  )
  sea.rotation.x = -Math.PI / 2
  // Why a group per island: a newly connected machine's island rises out of the sea as one piece.
  const groups = new Map<string, THREE.Group>()
  for (const isl of layout.islands) {
    const g = new THREE.Group()
    g.userData.island = isl.key
    world.add(g)
    groups.set(isl.key, g)
  }
  const groupAt = ([x, z]: DioramaPoint): THREE.Object3D => {
    const isl = layout.islands.find(
      ({ rect: r }) => Math.abs(x - r.x) <= r.hw && Math.abs(z - r.z) <= r.hd
    )
    return (isl && groups.get(isl.key)) ?? world
  }
  let off: DioramaKit | null = null
  for (const isl of layout.islands) {
    const parent = groups.get(isl.key)!
    const kk = isl.reachable ? k : (off ??= dioramaOffKit(k))
    dioramaIsland(kk, isl.rect, parent)
    for (const plot of isl.plots) {
      const stand = dioramaPlot(
        kk,
        plot,
        plot.key ? views.get(plot.key) : undefined,
        parent,
        isl.reachable,
        ticks
      )
      if (plot.key && stand) {
        const at = dioramaStandClear(
          layout,
          [plot.x + stand.dx, plot.z + stand.dz],
          [plot.x, plot.z]
        )
        stands.set(plot.key, { at, stand })
      }
      if (isl.home) {
        // Each home plot's own path out to the street or the lane.
        const toZ = plot.z < 0 ? 0.5 : DIORAMA_LANE_Z
        dioramaRoad(
          k,
          [
            [plot.x - 0.4, plot.z + 1.3],
            [plot.x - 0.4, toZ]
          ],
          parent,
          0.55
        )
      }
    }
    if (isl.dock) {
      const top = isl.rect.z - isl.rect.hd
      dioramaTravelDock(kk, parent, isl.rect.x, top + 0.25, 1.7, -1)
    }
    if (!isl.home) {
      dioramaTree(
        kk,
        isl.rect.x - isl.rect.hw + 0.55,
        isl.rect.z + 0.1,
        0.8,
        isl.column % 2 === 1,
        parent
      )
    }
    if (!isl.reachable) {
      ticks.push(fog(k, isl, parent))
    }
    const text = chipOf(isl, words)
    if (text) {
      const chip = dioramaChip(text)
      chip.position.set(isl.rect.x - isl.rect.hw - 0.35, 0.4, isl.rect.z + isl.rect.hd + 0.35)
      parent.add(chip)
    }
  }
  for (const r of layout.roads) {
    if (r.paved) {
      const one = r.pts.every((pt) => groupAt(pt) === groupAt(r.pts[0]!))
      dioramaRoad(k, r.pts, one ? groupAt(r.pts[0]!) : world)
    }
  }
  for (const d of Object.values(layout.homeDocks)) {
    dioramaTravelDock(k, world, d.end[0], 8.3, 1.8, 1)
  }
  ticks.push(dioramaKeep(k, world, DIORAMA_KEEP[0], DIORAMA_KEEP[1]))
  return { world, stands, ticks }
}
