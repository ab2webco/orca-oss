import * as THREE from 'three'
import type { TeamSceneFigureLook } from '../../../../shared/team-scene/team-scene-member-looks'
import type { DioramaKit } from './team-diorama-kit'
import { dioramaFlat, type DioramaPart } from './team-diorama-unit-parts'

// Why a port: the owner approved the prototype's chibi (makeUnit, ORCA-1296); its dress and
// headwear now follow the member's Team list sheet (ORCA-1336).

export type DioramaUnit = {
  g: THREE.Group
  legs: THREE.Group[]
  arms: THREE.Group[]
  body: THREE.Mesh
  head: THREE.Group
  tool: THREE.Group | null
  bodyY: number
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

/** The look's headwear, beard and hair, as its sheet draws them. */
function hat(part: DioramaPart, look: TeamSceneFigureLook, head: THREE.Group): void {
  const { headwear, headwearColor: hw, trim, hair } = look
  if (headwear === 'wizard') {
    part(cyl(0.44, 0.44, 0.04, 20), hw, 0, 0.17, 0, head)
    part(new THREE.ConeGeometry(0.27, 0.62, 16), hw, 0, 0.48, -0.03, head).rotation.x = -0.18
    part(cyl(0.275, 0.275, 0.07, 16), trim, 0, 0.22, 0, head, { outline: false })
  } else if (headwear === 'helm') {
    part(sphere(0.33, 18, 12, Math.PI * 0.55), hw, 0, 0.02, 0, head).rotation.x = -0.3
    part(new THREE.BoxGeometry(0.06, 0.2, 0.32), trim, 0, 0.36, -0.05, head)
  } else if (headwear === 'hood') {
    part(sphere(0.335, 18, 12, Math.PI * 0.6), hw, 0, 0.02, -0.03, head).rotation.x = -0.45
    part(new THREE.BoxGeometry(0.5, 0.3, 0.12), hw, 0, -0.2, -0.2, head)
  } else {
    part(sphere(0.315, 18, 10, Math.PI * 0.55), hair, 0, 0.02, -0.03, head).rotation.x = -0.35
  }
  if (headwear === 'hair') {
    // Why a bob: the sheet's long hair reaches the shoulders.
    part(new THREE.SphereGeometry(0.2, 12, 10), hair, 0, -0.16, -0.16, head).scale.set(1.4, 1, 0.8)
  } else if (headwear === 'headband') {
    part(cyl(0.32, 0.32, 0.08, 18), hw, 0, 0.1, 0, head)
  } else if (headwear === 'cap') {
    part(sphere(0.325, 18, 10, Math.PI * 0.42), hw, 0, 0.05, 0, head)
    part(cyl(0.2, 0.2, 0.025, 14), hw, 0, 0.1, 0.22, head)
    part(new THREE.ConeGeometry(0.05, 0.36, 8), trim, 0.06, 0.4, -0.12, head).rotation.x = -0.6
  } else if (headwear === 'crown') {
    part(cyl(0.21, 0.23, 0.13, 10, true), hw, 0, 0.33, 0, head)
    for (let n = 0; n < 5; n++) {
      const a = (n / 5) * Math.PI * 2
      const tip = new THREE.ConeGeometry(0.045, 0.12, 6)
      part(tip, hw, Math.sin(a) * 0.21, 0.44, Math.cos(a) * 0.21, head, { outline: false })
    }
  }
  if (look.beard !== null) {
    const beard = part(new THREE.SphereGeometry(0.17, 12, 10), look.beard, 0, -0.24, 0.13, head)
    beard.scale.set(1, 1.2, 0.7)
  }
}

/** What the look carries: the lead's banner, a staff or wand with its orb, a hammer, a bow. */
function gear(k: DioramaKit, part: DioramaPart, look: TeamSceneFigureLook, u: DioramaUnit): void {
  const [left, hand] = [u.arms[0]!, u.arms[1]!]
  if (look.cape !== null) {
    part(new THREE.BoxGeometry(0.52, 0.72, 0.05), look.cape, 0, 0.5, -0.24, u.g).rotation.x = 0.14
  }
  if (look.tool === 'banner') {
    part(cyl(0.03, 0.03, 1.7, 8), k.p.woodDark, -0.06, -0.05, 0.08, left)
    const banner = part(new THREE.PlaneGeometry(0.42, 0.3), 0xf7f5ef, -0.29, 0.62, 0.08, left)
    ;(banner.material as THREE.Material).side = THREE.DoubleSide
  } else if (look.tool === 'staff' || look.tool === 'wand') {
    const staff = look.tool === 'staff'
    part(cyl(0.03, 0.03, staff ? 1.2 : 0.6, 8), k.p.woodDark, 0, staff ? -0.2 : -0.4, 0.05, hand)
    const orb = new THREE.SphereGeometry(staff ? 0.08 : 0.06, 12, 10)
    part(orb, look.trim, 0, staff ? 0.42 : -0.1, 0.05, hand, { emissive: look.trim })
  } else if (look.tool === 'hammer') {
    const tool = new THREE.Group()
    tool.position.set(0, -0.38, 0.05)
    hand.add(tool)
    u.tool = tool
    part(new THREE.BoxGeometry(0.05, 0.05, 0.36), k.p.woodDark, 0, 0, 0.16, tool)
    part(new THREE.BoxGeometry(0.16, 0.12, 0.12), 0x8c8f94, 0, 0, 0.34, tool)
  } else if (look.tool === 'bow') {
    const bow = part(
      new THREE.TorusGeometry(0.32, 0.02, 6, 16, Math.PI),
      k.p.woodDark,
      0,
      -0.4,
      0.1,
      hand
    )
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2)
  }
}

/** The prototype's `makeUnit`: a toon chibi with an ink outline. */
export function dioramaToonUnit(
  k: DioramaKit,
  part: DioramaPart,
  look: TeamSceneFigureLook
): DioramaUnit {
  const g = new THREE.Group()
  const { skin, tunic } = look
  const legs: THREE.Group[] = []
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Group()
    leg.position.set(sx, 0.34, 0)
    g.add(leg)
    part(new THREE.BoxGeometry(0.13, 0.28, 0.15), look.pants, 0, -0.14, 0, leg)
    part(new THREE.BoxGeometry(0.15, 0.09, 0.21), 0x2a221c, 0, -0.3, 0.03, leg)
    legs.push(leg)
  }
  const body = part(cyl(0.19, 0.25, 0.44, 12), tunic, 0, 0.56, 0, g)
  if (look.robe) {
    part(cyl(0.22, 0.34, 0.5, 12), tunic, 0, 0.32, 0, g)
  }
  part(cyl(0.255, 0.255, 0.06, 12), look.trim, 0, 0.42, 0, g, { outline: false })
  const arms: THREE.Group[] = []
  for (const sx of [-0.27, 0.27]) {
    const arm = new THREE.Group()
    arm.position.set(sx, 0.74, 0)
    g.add(arm)
    part(new THREE.BoxGeometry(0.11, 0.34, 0.12), tunic, 0, -0.16, 0, arm)
    part(new THREE.SphereGeometry(0.07, 10, 8), skin, 0, -0.36, 0, arm)
    arms.push(arm)
  }
  const head = new THREE.Group()
  head.position.set(0, 1.08, 0)
  g.add(head)
  part(new THREE.SphereGeometry(0.3, 18, 14), skin, 0, 0, 0, head)
  face(head)
  hat(part, look, head)
  const u: DioramaUnit = { g, legs, arms, body, head, tool: null, bodyY: 0.56 }
  gear(k, part, look, u)
  return u
}
