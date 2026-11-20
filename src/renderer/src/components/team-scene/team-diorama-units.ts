import * as THREE from 'three'
import type { DioramaKit } from './team-diorama-kit'
import { dioramaFlat, type DioramaPart } from './team-diorama-unit-parts'

// Why a port, not a sketch: the owner approved these exact chibi figures in the prototype
// (makeUnit, ORCA-1296), so their parts, hats and tools stay as drawn there.

export type DioramaRole =
  | 'lead'
  | 'advisor'
  | 'mage'
  | 'wizard'
  | 'builder'
  | 'scout'
  | 'knight'
  | 'scholar'
  | 'smith'

export type DioramaUnit = {
  g: THREE.Group
  legs: THREE.Group[]
  arms: THREE.Group[]
  body: THREE.Mesh
  head: THREE.Group
  tool: THREE.Group | null
  bodyY: number
}

export const DIORAMA_COSTUMES: DioramaRole[] = [
  'wizard',
  'builder',
  'scout',
  'knight',
  'scholar',
  'smith'
]
export const DIORAMA_SKIN = [0xf2c9a0, 0xd9a274, 0xa86b45, 0xf5d5b5, 0xc28455, 0xe8b88e]
export const DIORAMA_HAIR = [0x4a3324, 0x8a5a2b, 0x2a221c, 0xd9a35a, 0x6b4428, 0x1f1a16]
/** Tunic, pants and robe per role, as the prototype dresses them. */
export const DIORAMA_DRESS: Record<DioramaRole, { tunic: number; pants: number; robe: boolean }> = {
  lead: { tunic: 0x3b5bb5, pants: 0x2c2f3a, robe: false },
  wizard: { tunic: 0x6d4aa0, pants: 0x3a2f4f, robe: true },
  builder: { tunic: 0xa0513a, pants: 0x4a3a2e, robe: false },
  scout: { tunic: 0x3f7a4a, pants: 0x4a3a2e, robe: false },
  knight: { tunic: 0x9aa3ad, pants: 0x5a6170, robe: false },
  scholar: { tunic: 0x2f6f7a, pants: 0x34403f, robe: true },
  smith: { tunic: 0xb07a3a, pants: 0x3e3530, robe: false },
  advisor: { tunic: 0x2f7f86, pants: 0x34403f, robe: true },
  mage: { tunic: 0x26357e, pants: 0x1d2552, robe: true }
}

const sphere = (r: number, w: number, h: number, thetaLength = Math.PI) =>
  new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, thetaLength)
const cyl = (top: number, bottom: number, h: number, seg: number, open = false) =>
  new THREE.CylinderGeometry(top, bottom, h, seg, 1, open)

/** The face: eyes with a highlight and soft cheeks. */
function face(head: THREE.Group): void {
  for (const ex of [-0.1, 0.1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), dioramaFlat(0x1b1815))
    e.scale.set(0.8, 1.25, 0.6)
    e.position.set(ex, 0, 0.275)
    head.add(e)
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), dioramaFlat(0xffffff))
    sh.position.set(ex + 0.012, 0.025, 0.3)
    head.add(sh)
  }
  const cheek = dioramaFlat(0xf09a8a, { transparent: true, opacity: 0.55 })
  for (const ex of [-0.17, 0.17]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), cheek)
    c.position.set(ex, -0.08, 0.262)
    c.rotation.y = ex * 1.6
    head.add(c)
  }
}

/** Each role's hat or hair. */
function hat(part: DioramaPart, role: DioramaRole, hair: number, head: THREE.Group): void {
  if (role === 'wizard' || role === 'mage') {
    const mage = role === 'mage'
    part(cyl(0.44, 0.44, 0.04, 20), mage ? 0x1a2558 : 0x4f3480, 0, 0.17, 0, head)
    const tall = mage ? 0.78 : 0.62
    const tip = part(
      new THREE.ConeGeometry(0.27, tall, 16),
      mage ? 0x26357e : 0x6d4aa0,
      0,
      mage ? 0.56 : 0.48,
      -0.03,
      head
    )
    tip.rotation.x = -0.18
    part(cyl(0.275, 0.275, 0.07, 16), 0xe9c46a, 0, 0.22, 0, head, { outline: false })
    part(new THREE.SphereGeometry(0.17, 12, 10), 0xeeeeee, 0, -0.24, 0.13, head).scale.set(
      1,
      1.2,
      0.7
    )
  } else if (role === 'knight') {
    part(sphere(0.33, 18, 12, Math.PI * 0.55), 0xb7c0c9, 0, 0.02, 0, head).rotation.x = -0.3
    part(new THREE.BoxGeometry(0.06, 0.2, 0.32), 0x3a5da8, 0, 0.36, -0.05, head)
  } else if (role === 'scout') {
    part(sphere(0.335, 18, 12, Math.PI * 0.6), 0x2f6a3c, 0, 0.02, -0.03, head).rotation.x = -0.45
    part(new THREE.ConeGeometry(0.12, 0.3, 10), 0x2f6a3c, 0, 0.12, -0.33, head).rotation.x = -1.9
  } else if (role === 'builder' || role === 'lead') {
    part(sphere(0.315, 18, 10, Math.PI * 0.5), hair, 0, 0.02, -0.02, head).rotation.x = -0.3
    if (role === 'builder') {
      part(cyl(0.315, 0.315, 0.09, 18), 0xc0392b, 0, 0.1, 0, head)
    } else {
      part(cyl(0.21, 0.23, 0.13, 10, true), 0xe9c46a, 0, 0.33, 0, head)
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2
        part(
          new THREE.ConeGeometry(0.045, 0.12, 6),
          0xe9c46a,
          Math.sin(a) * 0.21,
          0.44,
          Math.cos(a) * 0.21,
          head,
          { outline: false }
        )
      }
    }
  } else {
    part(sphere(0.315, 18, 10, Math.PI * 0.55), hair, 0, 0.02, -0.03, head).rotation.x = -0.35
    if (role === 'smith') {
      part(new THREE.SphereGeometry(0.16, 12, 10), hair, 0, -0.22, 0.12, head).scale.set(
        1.1,
        0.9,
        0.7
      )
    }
  }
  if (role === 'advisor') {
    for (const ex of [-0.1, 0.1]) {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.065, 0.013, 6, 16),
        dioramaFlat(0x2a2420)
      )
      rim.position.set(ex, 0, 0.285)
      head.add(rim)
    }
  }
}

/** What each role carries: the lead's cape and banner, a staff, a hammer, a lantern, a book. */
function gear(k: DioramaKit, part: DioramaPart, role: DioramaRole, u: DioramaUnit): void {
  const [left, hand] = [u.arms[0]!, u.arms[1]!]
  const toolAt = (arm: THREE.Group, y: number, z: number) => {
    const tool = new THREE.Group()
    tool.position.set(0, y, z)
    arm.add(tool)
    u.tool = tool
    return tool
  }
  if (role === 'lead') {
    part(new THREE.BoxGeometry(0.52, 0.72, 0.05), 0x9b2d3a, 0, 0.5, -0.24, u.g).rotation.x = 0.14
    part(cyl(0.03, 0.03, 1.7, 8), k.p.woodDark, -0.06, -0.05, 0.08, left)
    const banner = part(new THREE.PlaneGeometry(0.42, 0.3), 0xf7f5ef, -0.29, 0.62, 0.08, left)
    ;(banner.material as THREE.Material).side = THREE.DoubleSide
  } else if (role === 'wizard' || role === 'mage') {
    part(cyl(0.03, 0.03, 1.2, 8), k.p.woodDark, 0, -0.2, 0.05, hand)
    part(new THREE.SphereGeometry(0.08, 12, 10), 0xdff3ff, 0, 0.42, 0.05, hand, {
      emissive: 0x9fd8ff
    })
  } else if (role === 'builder' || role === 'smith') {
    const tool = toolAt(hand, -0.38, 0.05)
    part(new THREE.BoxGeometry(0.05, 0.05, 0.36), k.p.woodDark, 0, 0, 0.16, tool)
    part(new THREE.BoxGeometry(0.16, 0.12, 0.12), 0x8c8f94, 0, 0, 0.34, tool)
  } else if (role === 'knight') {
    part(new THREE.BoxGeometry(0.14, 0.18, 0.14), 0x3a3a3a, 0, -0.5, 0.05, left)
    part(new THREE.BoxGeometry(0.09, 0.1, 0.09), 0xffd98c, 0, -0.5, 0.05, left, {
      outline: false,
      emissive: 0xffc870
    })
  } else if (role === 'scholar') {
    part(new THREE.BoxGeometry(0.22, 0.28, 0.07), 0x7a3b2e, 0, -0.38, 0.12, left)
  } else if (role === 'scout') {
    part(new THREE.BoxGeometry(0.16, 0.2, 0.1), 0x6e4a2c, -0.22, 0.42, 0.12, u.g)
  } else if (role === 'advisor') {
    const tool = toolAt(hand, -0.4, 0.04)
    part(cyl(0.035, 0.055, 0.46, 10), 0xb08d57, 0, 0, 0.16, tool).rotation.x = Math.PI / 2
  }
}

/** The prototype's `makeUnit`: a toon chibi with an ink outline. */
export function dioramaToonUnit(
  k: DioramaKit,
  part: DioramaPart,
  role: DioramaRole,
  skin: number,
  hair: number
): DioramaUnit {
  const g = new THREE.Group()
  const C = DIORAMA_DRESS[role]
  const legs: THREE.Group[] = []
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Group()
    leg.position.set(sx, 0.34, 0)
    g.add(leg)
    part(new THREE.BoxGeometry(0.13, 0.28, 0.15), C.pants, 0, -0.14, 0, leg)
    part(new THREE.BoxGeometry(0.15, 0.09, 0.21), 0x2a221c, 0, -0.3, 0.03, leg)
    legs.push(leg)
  }
  const body = part(cyl(0.19, 0.25, 0.44, 12), C.tunic, 0, 0.56, 0, g)
  if (C.robe) {
    part(cyl(0.22, 0.34, 0.5, 12), C.tunic, 0, 0.32, 0, g)
  }
  if (role === 'smith') {
    part(new THREE.BoxGeometry(0.36, 0.42, 0.06), 0x5a3a26, 0, 0.5, 0.21, g)
  }
  if (role !== 'knight') {
    part(cyl(0.255, 0.255, 0.06, 12), 0x4a3322, 0, 0.42, 0, g, { outline: false })
  }
  const arms: THREE.Group[] = []
  for (const sx of [-0.27, 0.27]) {
    const arm = new THREE.Group()
    arm.position.set(sx, 0.74, 0)
    g.add(arm)
    part(new THREE.BoxGeometry(0.11, 0.34, 0.12), C.tunic, 0, -0.16, 0, arm)
    part(new THREE.SphereGeometry(0.07, 10, 8), skin, 0, -0.36, 0, arm)
    arms.push(arm)
  }
  const head = new THREE.Group()
  head.position.set(0, 1.08, 0)
  g.add(head)
  part(new THREE.SphereGeometry(0.3, 18, 14), skin, 0, 0, 0, head)
  face(head)
  hat(part, role, hair, head)
  const u: DioramaUnit = { g, legs, arms, body, head, tool: null, bodyY: 0.56 }
  gear(k, part, role, u)
  return u
}
