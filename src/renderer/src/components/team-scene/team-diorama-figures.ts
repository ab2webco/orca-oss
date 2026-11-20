import * as THREE from 'three'
import type { DioramaKit } from './team-diorama-kit'

// Why chibi with an ink outline: the owner chose 3D figures that read like the illustrated ones,
// turning toward where they walk, with no swords (ORCA-1296). Low resources draws a few flat parts.

export type DioramaRole = 'lead' | 'wizard' | 'builder' | 'scout' | 'knight' | 'scholar' | 'smith'
export type DioramaFigure = {
  g: THREE.Group
  legs: THREE.Group[]
  arms: THREE.Group[]
  body: THREE.Mesh
  head: THREE.Group
  bodyY: number
  /** Lowered while seated in a boat; 0 on the ground. */
  baseY: number
}

const COSTUMES: DioramaRole[] = ['wizard', 'builder', 'scout', 'knight', 'scholar', 'smith']
const SKIN = [0xf2c9a0, 0xd9a274, 0xa86b45, 0xf5d5b5, 0xc28455, 0xe8b88e]
const HAIR = [0x4a3324, 0x8a5a2b, 0x2a221c, 0xd9a35a, 0x6b4428, 0x1f1a16]
const TUNIC: Record<DioramaRole, number> = {
  lead: 0x3b5bb5,
  wizard: 0x6d4aa0,
  builder: 0xa0513a,
  scout: 0x3f7a4a,
  knight: 0x9aa3ad,
  scholar: 0x2f6f7a,
  smith: 0xb07a3a
}

/** A member's look, kept by its persistent character (or its pane) like the image styles do. */
export const dioramaLookOf = (seed: string): number => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  return (h >>> 0) % 36
}

const gradient = (() => {
  let tx: THREE.DataTexture | null = null
  return () => {
    if (!tx) {
      tx = new THREE.DataTexture(
        new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]),
        3,
        1
      )
      tx.minFilter = tx.magFilter = THREE.NearestFilter
      tx.needsUpdate = true
    }
    return tx
  }
})()

/** Builds a figure: toon parts with an inverted-hull outline, or flat ones when `lite`. */
export function dioramaFigure(
  k: DioramaKit,
  look: number,
  opts: { lead?: boolean; lite: boolean }
): DioramaFigure {
  const role: DioramaRole = opts.lead ? 'lead' : COSTUMES[look % COSTUMES.length]!
  const skin = SKIN[look % SKIN.length]!
  const hair = HAIR[Math.floor(look / 6) % HAIR.length]!
  const mats = new Map<number, THREE.Material>()
  const matOf = (hex: number) => {
    let m = mats.get(hex)
    if (!m) {
      m = opts.lite
        ? new THREE.MeshLambertMaterial({ color: hex, flatShading: true })
        : new THREE.MeshToonMaterial({ color: hex, gradientMap: gradient() })
      mats.set(hex, m)
    }
    return m
  }
  const ink = new THREE.MeshBasicMaterial({ color: 0x1b1815, side: THREE.BackSide })
  const part = (
    geo: THREE.BufferGeometry,
    hex: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D
  ) => {
    const m = new THREE.Mesh(geo, matOf(hex))
    m.position.set(x, y, z)
    m.castShadow = !opts.lite
    parent.add(m)
    if (!opts.lite) {
      geo.computeBoundingSphere()
      const outline = new THREE.Mesh(geo, ink)
      outline.scale.setScalar(1 + 0.028 / Math.max(0.05, geo.boundingSphere!.radius))
      m.add(outline)
    }
    return m
  }
  const g = new THREE.Group()
  const legs: THREE.Group[] = []
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Group()
    leg.position.set(sx, 0.34, 0)
    g.add(leg)
    part(k.box(0.13, 0.28, 0.15), 0x3d3a36, 0, -0.14, 0, leg)
    part(k.box(0.15, 0.09, 0.21), 0x2a221c, 0, -0.3, 0.03, leg)
    legs.push(leg)
  }
  const body = part(
    new THREE.CylinderGeometry(0.19, 0.25, 0.44, opts.lite ? 6 : 12),
    TUNIC[role],
    0,
    0.56,
    0,
    g
  )
  if (role === 'wizard' || role === 'scholar') {
    part(new THREE.CylinderGeometry(0.22, 0.34, 0.5, 12), TUNIC[role], 0, 0.32, 0, g)
  }
  const arms: THREE.Group[] = []
  for (const sx of [-0.27, 0.27]) {
    const arm = new THREE.Group()
    arm.position.set(sx, 0.74, 0)
    g.add(arm)
    part(k.box(0.11, 0.34, 0.12), TUNIC[role], 0, -0.16, 0, arm)
    part(new THREE.SphereGeometry(0.07, 8, 6), skin, 0, -0.36, 0, arm)
    arms.push(arm)
  }
  const head = new THREE.Group()
  head.position.set(0, 1.08, 0)
  g.add(head)
  part(
    opts.lite ? new THREE.IcosahedronGeometry(0.29, 0) : new THREE.SphereGeometry(0.3, 18, 14),
    skin,
    0,
    0,
    0,
    head
  )
  for (const ex of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x1b1815 })
    )
    eye.scale.set(0.8, 1.25, 0.6)
    eye.position.set(ex, 0, 0.275)
    head.add(eye)
  }
  if (role === 'wizard') {
    part(new THREE.ConeGeometry(0.27, 0.62, 12), 0x6d4aa0, 0, 0.48, -0.03, head).rotation.x = -0.18
  } else if (role === 'knight') {
    part(
      new THREE.SphereGeometry(0.33, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      0xb7c0c9,
      0,
      0.02,
      0,
      head
    ).rotation.x = -0.3
  } else if (role === 'lead') {
    part(new THREE.CylinderGeometry(0.21, 0.23, 0.13, 10), 0xe9c46a, 0, 0.33, 0, head)
    part(k.box(0.52, 0.72, 0.05), 0x9b2d3a, 0, 0.5, -0.24, g).rotation.x = 0.14
    // Why outward: the banner flies beside the head, never through it.
    part(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 8), k.p.woodDark, -0.06, -0.05, 0.08, arms[0]!)
    const banner = part(new THREE.PlaneGeometry(0.42, 0.3), k.p.banner, -0.29, 0.62, 0.08, arms[0]!)
    ;(banner.material as THREE.Material).side = THREE.DoubleSide
    g.scale.setScalar(1.12)
  } else {
    part(
      new THREE.SphereGeometry(0.315, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      role === 'scout' ? 0x2f6a3c : hair,
      0,
      0.02,
      -0.03,
      head
    ).rotation.x = -0.35
  }
  if (role === 'builder' || role === 'smith') {
    const tool = new THREE.Group()
    tool.position.set(0, -0.38, 0.05)
    arms[1]!.add(tool)
    part(k.box(0.05, 0.05, 0.36), k.p.woodDark, 0, 0, 0.16, tool)
    part(k.box(0.16, 0.12, 0.12), 0x8c8f94, 0, 0, 0.34, tool)
  }
  return { g, legs, arms, body, head, bodyY: 0.56, baseY: 0 }
}
