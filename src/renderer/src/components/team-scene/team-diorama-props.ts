import * as THREE from 'three'
import {
  DIORAMA_FARM,
  DIORAMA_FIRE,
  DIORAMA_LOGS,
  type DioramaSpot
} from '../../../../shared/team-scene/team-diorama-activities'
import type { DioramaKit } from './team-diorama-kit'
import type { DioramaFigure } from './team-diorama-figures'

// Why these props: free members fish, farm or chop and resting ones sit by the fire, so the
// home island carries a camp, a field, a wood pile and the advisor's tower (ORCA-1296).

export type DioramaTick = (t: number) => void

function flame(k: DioramaKit, x: number, z: number, parent: THREE.Object3D): DioramaTick {
  const color = k.status.risk
  const cones = [0, 1, 2, 3].map((n) => {
    const m = k.mesh(
      new THREE.ConeGeometry(0.12, 0.45, 5),
      new THREE.MeshBasicMaterial({ color: n % 2 ? color : 0xffe2a0 }),
      x + (n - 1.5) * 0.08,
      0.25,
      z,
      parent,
      false
    )
    return m
  })
  return (t) => cones.forEach((c, n) => c.scale.set(1, 0.8 + 0.22 * Math.sin(t * 4.2 + n * 1.7), 1))
}

/** The camp, the field, the wood pile and the advisor's tower; returns what moves each frame. */
export function dioramaHomeProps(k: DioramaKit, parent: THREE.Object3D): DioramaTick[] {
  const ticks: DioramaTick[] = []
  const tent = k.mesh(
    new THREE.ConeGeometry(0.95, 1.25, 4),
    k.mat(k.p.canvas),
    -7.6,
    0.62,
    3.3,
    parent
  )
  tent.rotation.y = Math.PI / 4
  for (let n = 0; n < 6; n++) {
    const a = (n / 6) * Math.PI * 2
    k.mesh(
      new THREE.DodecahedronGeometry(0.11, 0),
      k.mat(k.p.rock),
      DIORAMA_FIRE[0] + Math.cos(a) * 0.35,
      0.06,
      DIORAMA_FIRE[1] + Math.sin(a) * 0.35,
      parent
    )
  }
  ticks.push(flame(k, DIORAMA_FIRE[0], DIORAMA_FIRE[1], parent))
  for (let r = 0; r < 3; r++) {
    for (let n = 0; n < 3 - r; n++) {
      const log = k.mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7),
        k.mat(r % 2 ? k.p.wood : 0xc89463),
        DIORAMA_LOGS[0] + (n - (2 - r) / 2) * 0.23,
        0.11 + r * 0.19,
        DIORAMA_LOGS[1],
        parent
      )
      log.rotation.z = Math.PI / 2
    }
  }
  const { x, z, hw, hd } = DIORAMA_FARM
  k.mesh(k.box(hw * 2, 0.06, hd * 2), k.mat(k.p.dirt), x, 0.035, z, parent, false)
  const crops: THREE.Object3D[] = []
  for (let r = 0; r < 4; r++) {
    const rz = z - hd + 0.35 + r * ((hd * 2 - 0.7) / 3)
    for (let c = 0; c < 6; c++) {
      const crop = k.mesh(
        new THREE.ConeGeometry(0.08, 0.32 + ((r + c) % 3) * 0.12, 5),
        k.mat(c % 2 ? k.p.leaf : k.p.leaf3),
        x - hw + 0.4 + c * ((hw * 2 - 0.8) / 5),
        0.25,
        rz,
        parent
      )
      crops.push(crop)
    }
  }
  ticks.push((t) => crops.forEach((c, n) => (c.rotation.z = Math.sin(t * 1.1 + n) * 0.06)))
  const tower = new THREE.Group()
  tower.position.set(-0.9, 0, -5.3)
  parent.add(tower)
  for (const [px, pz] of [
    [-0.55, -0.55],
    [0.55, -0.55],
    [0.55, 0.55],
    [-0.55, 0.55]
  ] as const) {
    k.mesh(k.box(0.14, 2.3, 0.14), k.mat(k.p.woodDark), px, 1.15, pz, tower)
  }
  k.mesh(k.box(1.5, 0.14, 1.5), k.mat(k.p.wood), 0, 2.3, 0, tower)
  // Upper posts carry the roof, so it never floats above the platform.
  for (const [px, pz] of [
    [-0.68, -0.68],
    [0.68, -0.68],
    [0.68, 0.68],
    [-0.68, 0.68]
  ] as const) {
    k.mesh(k.box(0.07, 1.5, 0.07), k.mat(k.p.woodDark), px, 3.05, pz, tower)
  }
  const roof = k.mesh(new THREE.ConeGeometry(1.15, 0.8, 4), k.mat(k.p.roof2), 0, 4.1, 0, tower)
  roof.rotation.y = Math.PI / 4
  return ticks
}

/** Gives a free member its tool and returns what it does each frame at its spot. */
export function dioramaActivity(
  k: DioramaKit,
  spot: DioramaSpot,
  f: DioramaFigure,
  parent: THREE.Object3D
): DioramaTick | null {
  if (spot.kind === 'fish') {
    // The fisher's own short dock out over the water, a rod, a line and a bobbing float.
    const deck = k.mesh(
      k.box(1, 0.07, 2.6),
      k.mat(k.p.wood),
      spot.at[0],
      0.075,
      spot.at[1] - 0.9,
      parent,
      false
    )
    deck.rotation.y = Math.atan2(spot.face[0] - spot.at[0], spot.face[1] - spot.at[1])
    const rod = new THREE.Group()
    rod.position.set(0, -0.36, 0.04)
    rod.rotation.x = -0.15
    f.arms[1]!.add(rod)
    k.mesh(new THREE.CylinderGeometry(0.018, 0.028, 2.1, 6), k.mat(0x5a3a22), 0, 1, 0, rod)
    const tip = new THREE.Object3D()
    tip.position.set(0, 2.05, 0)
    rod.add(tip)
    const float = k.mesh(new THREE.SphereGeometry(0.09, 10, 8), k.mat(0xf2f2f2), 0, 0, 0, parent)
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x2a2a2a })
    )
    parent.add(line)
    const water = [
      spot.at[0] + (spot.face[0] - spot.at[0]) * 0.8,
      spot.at[1] + (spot.face[1] - spot.at[1]) * 0.8
    ]
    return (t) => {
      float.position.set(water[0]!, -0.74 + Math.sin(t * 1.7) * 0.03, water[1]!)
      line.geometry.setFromPoints([
        tip.getWorldPosition(new THREE.Vector3()),
        float.position.clone()
      ])
    }
  }
  if (spot.kind === 'chop') {
    const axe = new THREE.Group()
    axe.position.set(0, -0.38, 0.05)
    f.arms[1]!.add(axe)
    k.mesh(k.box(0.05, 0.05, 0.5), k.mat(0x6e4a2c), 0, 0, 0.22, axe)
    k.mesh(k.box(0.04, 0.2, 0.16), k.mat(0xa9adb3), 0, -0.06, 0.44, axe)
    return null
  }
  if (spot.kind === 'farm') {
    const can = new THREE.Group()
    can.position.set(0, -0.4, 0.08)
    f.arms[1]!.add(can)
    k.mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 10), k.mat(0x6f8fa8), 0, 0, 0.06, can)
  }
  return null
}
