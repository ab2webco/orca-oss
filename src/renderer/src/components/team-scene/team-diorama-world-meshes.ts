import * as THREE from 'three'
import type {
  DioramaIsland,
  DioramaLayout,
  DioramaPoint
} from '../../../../shared/team-scene/team-diorama-layout'
import { DIORAMA_KEEP } from '../../../../shared/team-scene/team-diorama-layout'
import type { DioramaPlotView } from '../../../../shared/team-scene/team-diorama-actions'
import type { DioramaKit } from './team-diorama-kit'

// Why every surface has its own height: two faces at one height flicker (z-fighting), as the
// prototype's dock decks did on the grass (ORCA-1296). Grass tops sit at y 0, roads at 0.03,
// plots at 0.04 and decks at 0.075.

function island(k: DioramaKit, isl: DioramaIsland, parent: THREE.Object3D) {
  const { x, z, hw, hd } = isl.rect
  const dim = !isl.reachable
  const tone = (hex: number) =>
    dim ? new THREE.Color(hex).lerp(new THREE.Color(0x8a8a8a), 0.75).getHex() : hex
  k.mesh(k.box(hw * 2, 0.22, hd * 2), k.mat(tone(k.p.grass)), x, -0.11, z, parent, false)
  k.mesh(
    k.box(hw * 2 - 0.05, 0.7, hd * 2 - 0.05),
    k.mat(tone(k.p.dirt)),
    x,
    -0.55,
    z,
    parent,
    false
  )
  k.mesh(k.box(hw * 2 + 0.9, 0.3, hd * 2 + 0.9), k.mat(tone(k.p.sand)), x, -0.78, z, parent, false)
}

function road(k: DioramaKit, pts: DioramaPoint[], parent: THREE.Object3D) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!,
      [bx, bz] = pts[i + 1]!
    const seg = k.mesh(
      k.box(0.75, 0.03, Math.hypot(bx - ax, bz - az) + 0.75),
      k.mat(k.p.path),
      (ax + bx) / 2,
      0.015,
      (az + bz) / 2,
      parent,
      false
    )
    seg.rotation.y = Math.atan2(bx - ax, bz - az)
  }
}

function dock(k: DioramaKit, from: DioramaPoint, to: DioramaPoint, parent: THREE.Object3D) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) + 0.6
  const deck = k.mesh(
    k.box(1, 0.07, len),
    k.mat(k.p.wood),
    (from[0] + to[0]) / 2,
    0.075,
    (from[1] + to[1]) / 2,
    parent,
    false
  )
  deck.rotation.y = Math.atan2(to[0] - from[0], to[1] - from[1])
  for (const side of [-0.48, 0.48]) {
    k.mesh(k.box(0.1, 1.1, 0.1), k.mat(k.p.woodDark), to[0] + side, -0.45, to[1], parent)
  }
}

export function dioramaTree(
  k: DioramaKit,
  x: number,
  z: number,
  s: number,
  pine: boolean,
  parent: THREE.Object3D
) {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.scale.setScalar(s)
  parent.add(g)
  k.mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.6, 6), k.mat(k.p.trunk), 0, 0.3, 0, g)
  if (pine) {
    k.mesh(new THREE.ConeGeometry(0.6, 1, 7), k.mat(k.p.leaf2), 0, 0.95, 0, g)
    k.mesh(new THREE.ConeGeometry(0.42, 0.8, 7), k.mat(k.p.leaf), 0, 1.4, 0, g)
  } else {
    k.mesh(new THREE.IcosahedronGeometry(0.6, 0), k.mat(k.p.leaf), 0, 1.05, 0, g)
    k.mesh(new THREE.IcosahedronGeometry(0.4, 0), k.mat(k.p.leaf3), 0.22, 1.35, 0.12, g)
  }
}

/** A member's build at its plot, by the stage its real work reached. */
export function dioramaHouse(
  k: DioramaKit,
  x: number,
  z: number,
  view: Pick<DioramaPlotView, 'stage' | 'scaffold' | 'flag'>,
  parent: THREE.Object3D
) {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  parent.add(g)
  const S = 1.8
  k.mesh(k.box(2.7, 0.04, 2.7), k.mat(k.p.pad), 0, 0.02, 0, g, false)
  if (view.stage >= 1) {
    k.mesh(k.box(S + 0.2, 0.22, S + 0.2), k.mat(k.p.stone2), 0, 0.15, 0, g)
  }
  if (view.stage === 2) {
    for (const [px, pz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1]
    ]) {
      k.mesh(k.box(0.12, 1.3, 0.12), k.mat(k.p.wood), (px! * S) / 2, 0.88, (pz! * S) / 2, g)
    }
    k.mesh(k.box(S, 0.5, 0.1), k.mat(k.p.wood), 0, 0.5, S / 2, g)
  }
  if (view.stage >= 3) {
    k.mesh(k.box(S, 1.25, S), k.mat(k.p.plaster), 0, 0.86, 0, g)
    const win = k.p.lit ? k.mat(k.p.window, { emissive: 0xffc870, ei: 1.1 }) : k.mat(k.p.window)
    k.mesh(k.box(0.34, 0.36, 0.05), win, 0.45, 0.95, S / 2 + 0.01, g)
    k.mesh(k.box(0.42, 0.72, 0.05), k.mat(k.p.woodDark), -0.4, 0.6, S / 2 + 0.01, g)
  }
  if (view.stage >= 4) {
    const roof = k.mesh(new THREE.ConeGeometry(1.55, 1.05, 4), k.mat(k.p.roof), 0, 2.02, 0, g)
    roof.rotation.y = Math.PI / 4
  }
  if (view.scaffold) {
    const color = view.scaffold === 'lit' ? k.status.working : k.p.woodDark
    const m =
      view.scaffold === 'lit'
        ? k.mat(color, { emissive: color, ei: k.p.lit ? 1.2 : 0.5 })
        : k.mat(color)
    for (const [px, pz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1]
    ]) {
      k.mesh(k.box(0.07, 2.3, 0.07), m, px! * 1.2, 1.15, pz! * 1.2, g)
    }
  }
  if (view.flag) {
    const color = view.flag === 'merged' ? k.status.done : k.p.banner
    k.mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.2, 6), k.mat(k.p.woodDark), 1.35, 1.1, 1.25, g)
    const cloth = k.mesh(new THREE.PlaneGeometry(0.8, 0.48), k.mat(color), 1.75, 1.95, 1.25, g)
    ;(cloth.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    g.userData.flag = cloth
  }
  return g
}

function keep(k: DioramaKit, parent: THREE.Object3D) {
  const g = new THREE.Group()
  g.position.set(DIORAMA_KEEP[0], 0, DIORAMA_KEEP[1])
  parent.add(g)
  k.mesh(k.box(3.4, 0.3, 3.4), k.mat(k.p.stone2), 0, 0.15, 0, g)
  k.mesh(k.box(3, 1.9, 3), k.mat(k.p.stone), 0, 1.25, 0, g)
  k.mesh(new THREE.CylinderGeometry(0.85, 0.95, 3.2, 10), k.mat(k.p.stone), -0.5, 3.1, -0.5, g)
  k.mesh(new THREE.ConeGeometry(1.15, 1.5, 10), k.mat(k.p.roof), -0.5, 5.45, -0.5, g)
  k.mesh(k.box(0.75, 1.15, 0.08), k.mat(0x2a2420), 0.55, 0.88, 1.51, g)
}

/** The static world: sea, islands, roads, docks, the keep, plots and their builds, and props. */
export function dioramaWorld(
  k: DioramaKit,
  layout: DioramaLayout,
  views: ReadonlyMap<string, DioramaPlotView>
): THREE.Group {
  const world = new THREE.Group()
  const sea = k.mesh(new THREE.PlaneGeometry(600, 600), k.mat(k.p.sea), 0, -0.95, 0, world, false)
  sea.rotation.x = -Math.PI / 2
  for (const isl of layout.islands) {
    island(k, isl, world)
    for (const plot of isl.plots) {
      const view = plot.key ? views.get(plot.key) : undefined
      if (view) {
        dioramaHouse(k, plot.x, plot.z, view, world)
      } else {
        k.mesh(
          k.box(2.7, 0.04, 2.7),
          k.mat(k.p.pad, plot.taken ? { opacity: 0.5 } : {}),
          plot.x,
          0.02,
          plot.z,
          world,
          false
        )
      }
    }
    if (isl.dock) {
      dock(k, [isl.rect.x, isl.rect.z - isl.rect.hd + 0.25], isl.dock.end, world)
    }
    if (!isl.home) {
      dioramaTree(
        k,
        isl.rect.x - isl.rect.hw + 0.55,
        isl.rect.z + 0.1,
        0.8,
        isl.column % 2 === 1,
        world
      )
    }
  }
  for (const r of layout.roads) {
    if (r.paved) {
      road(k, r.pts, world)
    }
  }
  for (const d of Object.values(layout.homeDocks)) {
    dock(k, [d.end[0], 8.3], d.end, world)
  }
  keep(k, world)
  for (const [x, z, pine] of [
    [-8.6, -5.6, true],
    [-7.4, -5.9, false],
    [9, -5.7, false],
    [-12.3, -5.8, true],
    [-12.4, -0.8, false]
  ] as const) {
    dioramaTree(k, x, z, 1, pine, world)
  }
  return world
}
