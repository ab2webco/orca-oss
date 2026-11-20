import * as THREE from 'three'
import type { DioramaKit } from './team-diorama-kit'

// Why a port: the keep, the houses, the flags and the CI scaffold are the approved prototype's
// own (house, keep, flag, scaffold; ORCA-1296), timber frames, windows and crenels included.

export type DioramaTick = (t: number) => void

const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
] as const

/** A member's build by stage: 1 foundation, 2 frame, 3 walls and windows, 4 roof and chimney. */
export function dioramaHouse(
  k: DioramaKit,
  x: number,
  z: number,
  stage: number,
  parent: THREE.Object3D,
  opts: { scale?: number; noPad?: boolean; roof?: number } = {}
): THREE.Group {
  const { p, mat, box } = k
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.scale.setScalar(opts.scale ?? 1)
  parent.add(g)
  const S = 1.8
  const at = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) =>
    k.mesh(geo, m, px, py, pz, g)
  if (!opts.noPad) {
    k.mesh(box(2.7, 0.05, 2.7), mat(p.pad), 0, 0.025, 0, g, false)
  }
  if (stage >= 1) {
    at(box(S + 0.2, 0.22, S + 0.2), mat(p.stone2), 0, 0.13, 0)
  }
  if (stage === 2) {
    for (const [px, pz] of CORNERS) {
      at(box(0.12, 1.3, 0.12), mat(p.wood), (px * S) / 2, 0.88, (pz * S) / 2)
    }
    at(box(S, 0.5, 0.1), mat(p.wood), 0, 0.5, S / 2)
    at(box(0.1, 0.5, S), mat(p.wood), S / 2, 0.5, 0)
    at(box(S, 0.08, 0.1), mat(p.woodDark), 0, 1.5, S / 2)
    at(box(0.1, 0.08, S), mat(p.woodDark), S / 2, 1.5, 0)
    at(box(S, 0.08, 0.1), mat(p.woodDark), 0, 1.5, -S / 2)
    at(box(0.1, 0.08, S), mat(p.woodDark), -S / 2, 1.5, 0)
  }
  let roofTop = 1.4
  if (stage >= 3) {
    at(box(S, 1.25, S), mat(p.plaster), 0, 0.86, 0)
    for (const [px, pz] of CORNERS) {
      at(box(0.13, 1.27, 0.13), mat(p.timber), (px * S) / 2, 0.86, (pz * S) / 2)
    }
    at(box(S + 0.04, 0.1, S + 0.04), mat(p.timber), 0, 1.45, 0)
    const wm = k.windowMat()
    at(box(0.34, 0.36, 0.05), wm, 0.45, 0.95, S / 2 + 0.01)
    at(box(0.05, 0.36, 0.34), wm, S / 2 + 0.01, 0.95, -0.4)
    at(box(0.05, 0.36, 0.34), wm, S / 2 + 0.01, 0.95, 0.4)
    at(box(0.42, 0.72, 0.05), mat(p.woodDark), -0.4, 0.6, S / 2 + 0.01)
    if (p.lit) {
      k.glow(g, 0.45, 0.95, S / 2 + 0.2, 0xffc870, 0.9, 0.55)
      k.glow(g, S / 2 + 0.2, 0.95, 0, 0xffc870, 1.1, 0.5)
    }
  }
  if (stage >= 4) {
    const roof = at(new THREE.ConeGeometry(1.55, 1.05, 4), mat(opts.roof ?? p.roof), 0, 2.02, 0)
    roof.rotation.y = Math.PI / 4
    at(box(0.22, 0.55, 0.22), mat(p.stoneDark), 0.45, 2.15, -0.35)
    roofTop = 2.6
  }
  g.userData.roofTop = roofTop
  return g
}

/** A pole and a cloth that ripples in the wind. */
export function dioramaFlag(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  z: number,
  hex: number | string,
  h = 2.2,
  w = 0.8
): DioramaTick {
  k.mesh(new THREE.CylinderGeometry(0.035, 0.04, h, 6), k.mat(k.p.woodDark), x, h / 2, z, parent)
  const geo = new THREE.PlaneGeometry(w, w * 0.6, 8, 3)
  geo.translate(w / 2, 0, 0)
  const m = k.mat(hex, { unique: true, emissive: hex, ei: 0.08 })
  m.side = THREE.DoubleSide
  const cloth = k.mesh(geo, m, x + 0.03, h - w * 0.32, z, parent)
  cloth.userData.flag = true
  const pos = geo.attributes.position!
  const base = Float32Array.from(pos.array)
  const phase = k.rnd() * 6
  return (t) => {
    const a = pos.array as Float32Array
    for (let n = 0; n < a.length; n += 3) {
      const u = base[n]! / w
      a[n + 2] = Math.sin(base[n]! * 5 - t * 3.2 + phase) * 0.08 * u
      a[n + 1] = base[n + 1]! - u * 0.04 * Math.sin(t * 3 + phase)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  }
}

/** CI running: a scaffold lit in the working colour, its lanterns breathing. */
export function dioramaScaffold(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  z: number,
  hex: number | string
): DioramaTick {
  const lit = k.p.lit
  const m = k.mat(hex, { emissive: hex, ei: lit ? 1.3 : 0.55, unique: true })
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.userData.scaffold = true
  parent.add(g)
  const s = 1.2
  for (const [px, pz] of CORNERS) {
    k.mesh(k.box(0.07, 2.3, 0.07), m, px * s, 1.15, pz * s, g)
  }
  for (const y of [0.8, 1.6, 2.25]) {
    k.mesh(k.box(2 * s, 0.06, 0.06), m, 0, y, s, g)
    k.mesh(k.box(2 * s, 0.06, 0.06), m, 0, y, -s, g)
    k.mesh(k.box(0.06, 0.06, 2 * s), m, s, y, 0, g)
    k.mesh(k.box(0.06, 0.06, 2 * s), m, -s, y, 0, g)
  }
  const lamps = (
    [
      [1, 1],
      [-1, 1],
      [1, -1]
    ] as const
  ).map(([px, pz]) => {
    const l = k.mesh(k.box(0.16, 0.2, 0.16), k.basic(hex), px * s, 2.42, pz * s, g)
    return [l, k.glow(g, px * s, 2.42, pz * s, hex, 1.1, lit ? 0.9 : 0.55)] as const
  })
  return (t) => {
    m.emissiveIntensity = (lit ? 1.1 : 0.45) + Math.sin(t * 1.4) * 0.2
    lamps.forEach(([l, gl], n) => {
      const v = 0.55 + 0.45 * Math.sin(t * 1.6 + n * 2.1)
      gl.material.opacity = (lit ? 0.9 : 0.55) * v
      l.scale.setScalar(0.85 + 0.15 * v)
    })
  }
}

/** The keep: a crenellated hall, a round tower with its banner, an arched gate and windows. */
export function dioramaKeep(k: DioramaKit, parent: THREE.Object3D, x: number, z: number) {
  const { p, mat, box } = k
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  parent.add(g)
  k.mesh(box(3.4, 0.3, 3.4), mat(p.stone2), 0, 0.15, 0, g)
  k.mesh(box(3, 1.9, 3), mat(p.stone), 0, 1.25, 0, g)
  for (let n = -1; n <= 1; n += 0.5) {
    for (const [cx, cz] of [
      [n * 1.33, 1.33],
      [1.33, n * 1.33],
      [n * 1.33, -1.33],
      [-1.33, n * 1.33]
    ] as const) {
      k.mesh(box(0.34, 0.32, 0.34), mat(p.stone), cx, 2.36, cz, g)
    }
  }
  k.mesh(new THREE.CylinderGeometry(0.85, 0.95, 3.2, 10), mat(p.stone), -0.5, 3.1, -0.5, g)
  k.mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.25, 10), mat(p.stone2), -0.5, 4.8, -0.5, g)
  k.mesh(new THREE.ConeGeometry(1.15, 1.5, 10), mat(p.roof), -0.5, 5.65, -0.5, g)
  k.mesh(box(0.75, 1.15, 0.08), mat(0x2a2420), 0.55, 0.88, 1.51, g)
  const arch = k.mesh(
    new THREE.CylinderGeometry(0.375, 0.375, 0.08, 12, 1, false, 0, Math.PI),
    mat(0x2a2420),
    0.55,
    1.45,
    1.51,
    g
  )
  arch.rotation.x = Math.PI / 2
  arch.rotation.z = Math.PI / 2
  const wm = k.windowMat()
  for (const [wx, wy, wz, side] of [
    [-0.6, 1.5, 1.51, false],
    [1.51, 1.5, 0.6, true],
    [1.51, 1.5, -0.6, true],
    [-0.5, 3.7, 0.37, false],
    [0.37, 3.7, -0.5, true]
  ] as const) {
    k.mesh(side ? box(0.06, 0.42, 0.28) : box(0.28, 0.42, 0.06), wm, wx, wy, wz, g)
    if (p.lit) {
      k.glow(g, wx + (side ? 0.2 : 0), wy, wz + (side ? 0 : 0.2), 0xffc870, 1, 0.55)
    }
  }
  return dioramaFlag(k, g, -0.5, -0.5, p.banner, 7.3, 0.9)
}
