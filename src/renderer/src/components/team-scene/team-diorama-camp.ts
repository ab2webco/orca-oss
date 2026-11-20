import * as THREE from 'three'
import {
  DIORAMA_FARM,
  DIORAMA_FIRE,
  DIORAMA_LOGS
} from '../../../../shared/team-scene/team-diorama-activities'
import { dioramaFlag, dioramaHouse, type DioramaTick } from './team-diorama-buildings'
import { DIORAMA_UNIT_SCALE } from './team-diorama-figures'
import { dioramaFire } from './team-diorama-fx'
import type { DioramaKit } from './team-diorama-kit'
import { dioramaGulls, dioramaRock, dioramaSailboat, dioramaTree } from './team-diorama-scenery'

// Why a port: the home island's camp, field, wood pile, back houses and lookout are the approved
// prototype's (tent, campfire, logPile, farm, advisorTower; ORCA-1296).

/** The lookout's place; it is drawn at the figures' scale so Jev stands under its roof. */
export const DIORAMA_TOWER_AT: readonly [number, number] = [-0.9, -5.3]
export const DIORAMA_TOWER_PLATFORM = 2.37 * DIORAMA_UNIT_SCALE

export function dioramaLogPile(k: DioramaKit, parent: THREE.Object3D, x: number, z: number) {
  for (let r = 0; r < 3; r++) {
    for (let n = 0; n < 3 - r; n++) {
      const log = k.mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7),
        k.mat(r % 2 ? k.p.wood : 0xc89463),
        x + (n - (2 - r) / 2) * 0.23,
        0.11 + r * 0.19,
        z,
        parent
      )
      log.rotation.z = Math.PI / 2
    }
  }
}

export function dioramaPlankPile(k: DioramaKit, parent: THREE.Object3D, x: number, z: number) {
  for (let n = 0; n < 4; n++) {
    const tone = n % 2 ? k.p.wood : 0xc89463
    k.mesh(k.box(1.1, 0.07, 0.24), k.mat(tone), x, 0.04 + n * 0.075, z + (n % 2) * 0.03, parent)
  }
}

function campfire(k: DioramaKit, parent: THREE.Object3D, x: number, z: number): DioramaTick {
  for (let n = 0; n < 6; n++) {
    const a = (n / 6) * Math.PI * 2
    dioramaRock(k, parent, x + Math.cos(a) * 0.35, z + Math.sin(a) * 0.35, 0.11)
  }
  for (const yaw of [0.6, -0.6]) {
    k.mesh(k.box(0.6, 0.08, 0.08), k.mat(k.p.woodDark), x, 0.06, z, parent).rotation.y = yaw
  }
  return dioramaFire(k, parent, x, 0.05, z, k.status.risk, 0.75)
}

/** Tilled rows of crops at three heights, pumpkins in the front row, a low fence behind. */
function field(k: DioramaKit, parent: THREE.Object3D): DioramaTick {
  const { x, z } = DIORAMA_FARM
  const [w, d] = [DIORAMA_FARM.hw * 2, DIORAMA_FARM.hd * 2]
  k.mesh(k.box(w, 0.06, d), k.mat(k.p.dirt), x, 0.03, z, parent, false)
  const crops: [THREE.Group, number][] = []
  for (let r = 0; r < 4; r++) {
    const rz = z - d / 2 + 0.35 + r * ((d - 0.7) / 3)
    k.mesh(k.box(w - 0.3, 0.1, 0.26), k.mat(k.p.dirtDark), x, 0.08, rz, parent, false)
    for (let c = 0; c < 6; c++) {
      const g = new THREE.Group()
      g.position.set(x - w / 2 + 0.4 + c * ((w - 0.8) / 5), 0.12, rz)
      parent.add(g)
      const stage = (r + c) % 3
      if (r === 3 && c % 2 === 0) {
        k.mesh(new THREE.SphereGeometry(0.15, 10, 8), k.mat(0xd9822b), 0, 0.1, 0, g).scale.set(
          1.15,
          0.85,
          1.15
        )
        k.mesh(new THREE.ConeGeometry(0.05, 0.1, 5), k.mat(k.p.leaf2), 0, 0.24, 0, g)
      } else {
        for (let n = 0; n < 3; n++) {
          const leaf = k.mesh(
            new THREE.ConeGeometry(0.06, 0.28 + stage * 0.12, 5),
            k.mat(n % 2 ? k.p.leaf : k.p.leaf3),
            Math.cos(n * 2.1) * 0.05,
            0.14 + stage * 0.06,
            Math.sin(n * 2.1) * 0.05,
            g
          )
          leaf.rotation.set(Math.sin(n * 2.1) * 0.35, 0, Math.cos(n * 2.1) * 0.35)
        }
      }
      crops.push([g, k.rnd() * 6])
    }
  }
  const [x0, z0] = [x - w / 2 - 0.15, z - d / 2 - 0.15]
  for (const [fx1, fz1] of [
    [x + w / 2 + 0.15, z0],
    [x0, z + d / 2 + 0.15]
  ] as const) {
    const L = Math.hypot(fx1 - x0, fz1 - z0)
    const n = Math.round(L / 0.6)
    for (let i = 0; i <= n; i++) {
      const [px, pz] = [x0 + ((fx1 - x0) * i) / n, z0 + ((fz1 - z0) * i) / n]
      k.mesh(k.box(0.07, 0.45, 0.07), k.mat(k.p.woodDark), px, 0.22, pz, parent)
    }
    const rail = k.mesh(
      k.box(0.05, 0.05, L),
      k.mat(k.p.woodDark),
      (x0 + fx1) / 2,
      0.34,
      (z0 + fz1) / 2,
      parent
    )
    rail.rotation.y = Math.atan2(fx1 - x0, fz1 - z0)
  }
  return (t) => crops.forEach(([g, p]) => (g.rotation.z = Math.sin(t * 1.1 + p) * 0.06))
}

/** Jev's lookout: posts, rails, a railed platform, a ladder and a roof. */
function tower(k: DioramaKit, parent: THREE.Object3D) {
  const g = new THREE.Group()
  g.position.set(DIORAMA_TOWER_AT[0], 0, DIORAMA_TOWER_AT[1])
  g.scale.setScalar(DIORAMA_UNIT_SCALE)
  g.userData.tower = true
  parent.add(g)
  const { mat, box, p } = k
  const corners = (r: number) =>
    [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r]
    ] as const
  for (const [px, pz] of corners(0.55)) {
    k.mesh(box(0.14, 2.3, 0.14), mat(p.woodDark), px, 1.15, pz, g)
  }
  for (const y of [0.8, 1.6]) {
    k.mesh(box(1.2, 0.07, 0.07), mat(p.wood), 0, y, 0.55, g)
    k.mesh(box(0.07, 0.07, 1.2), mat(p.wood), 0.55, y, 0, g)
  }
  k.mesh(box(1.5, 0.14, 1.5), mat(p.wood), 0, 2.3, 0, g)
  for (const [rx, rz, w, d] of [
    [0, 0.72, 1.5, 0.06],
    [0, -0.72, 1.5, 0.06],
    [0.72, 0, 0.06, 1.5],
    [-0.72, 0, 0.06, 1.5]
  ] as const) {
    k.mesh(box(w, 0.06, d), mat(p.woodDark), rx, 2.72, rz, g)
  }
  for (const [px, pz] of corners(0.68)) {
    k.mesh(box(0.06, 1.5, 0.06), mat(p.woodDark), px, 3.05, pz, g)
  }
  k.mesh(new THREE.ConeGeometry(1.15, 0.8, 4), mat(p.roof2), 0, 4.15, 0, g).rotation.y = Math.PI / 4
  for (let n = 0; n < 6; n++) {
    k.mesh(box(0.5, 0.05, 0.05), mat(p.wood), 0, 0.3 + n * 0.36, 0.75, g)
  }
}

const TREES = [
  [-8.6, -5.6, true, 1.1],
  [-7.4, -5.9, false, 1],
  [9, -5.7, false, 1.15],
  [-12.3, -5.8, true, 1.05],
  [-12.4, -0.8, false, 0.95],
  [-12.2, 1.9, true, 0.9],
  [-3.4, 7.9, false, 0.9],
  [5, 7.7, true, 0.85]
] as const

/** The home island's fixed props; returns what moves each frame. */
export function dioramaHomeProps(
  k: DioramaKit,
  parent: THREE.Object3D,
  lite: boolean
): DioramaTick[] {
  const ticks: DioramaTick[] = []
  for (const [x, z, pine, s] of TREES) {
    dioramaTree(k, x, z, s, pine, parent)
  }
  for (const [x, z] of [
    [-1.6, 7.3],
    [9.1, -3],
    [-9.2, -2.8]
  ] as const) {
    dioramaRock(k, parent, x, z, 0.3)
  }
  ;(
    [
      [1.8, -5.3],
      [5.2, -5.4],
      [-3.6, -5.2]
    ] as const
  ).forEach(([x, z], n) => {
    dioramaHouse(k, x, z, 4, parent, {
      scale: 0.68,
      noPad: true,
      roof: n % 2 ? k.p.roof2 : k.p.roof
    })
    ticks.push(dioramaFlag(k, parent, x + 1, z + 0.6, k.status.done, 1.4, 0.45))
  })
  const tent = k.mesh(
    new THREE.ConeGeometry(0.95, 1.25, 4),
    k.mat(k.p.canvas),
    -7.6,
    0.62,
    3.3,
    parent
  )
  tent.rotation.y = Math.PI / 4
  k.mesh(k.box(0.34, 0.6, 0.05), k.mat(0x2a2420), -7.6 + 0.33, 0.3, 3.3 + 0.33, parent).rotation.y =
    Math.PI / 4
  ticks.push(campfire(k, parent, DIORAMA_FIRE[0], DIORAMA_FIRE[1]))
  dioramaLogPile(k, parent, DIORAMA_LOGS[0], DIORAMA_LOGS[1])
  ticks.push(field(k, parent))
  tower(k, parent)
  ticks.push(dioramaSailboat(k, parent, -4, -13.5, 8, 3, 0.07))
  if (!lite) {
    ticks.push(dioramaGulls(k, parent, -2, 0, 3))
  }
  return ticks
}
