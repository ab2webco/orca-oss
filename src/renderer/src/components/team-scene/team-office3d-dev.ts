import * as THREE from 'three'
import { DIORAMA_UNIT_SCALE, type DioramaFigure } from './team-diorama-figures'
import {
  OFFICE_ADVISOR_LOOK,
  OFFICE_LEAD_LOOK,
  teamSceneLookSeedOf,
  teamSceneOfficeLookOf
} from '../../../../shared/team-scene/team-scene-member-looks'
import { dioramaFlat, dioramaParts, type DioramaPart } from './team-diorama-unit-parts'

// Why developers in sweaters: the owner asked for an office team, not the diorama's costumes, on
// the same toon kit and proportions so every diorama pose still fits (ORCA-1302). The Office is 3D
// only in Illustrated; Low resources keeps the 2D Office, so there is no low-poly developer.

export type Office3dRole = 'dev' | 'lead' | 'advisor' | 'steward'

const SHOES = [0xf4f3ee, 0x2a2d34, 0x6e4a2c, 0x3d4a5c]
const HAIRDOS = ['crop', 'bun', 'curly', 'long', 'part', 'pony', 'buzz', 'beanie'] as const
const KNITS = ['stripe', 'plain', 'cardigan', 'turtle', 'band2', 'collar'] as const
/** The marker over the lead's head, so it reads at a glance; its clothes follow its sheet. */
export const OFFICE3D_LEAD_COAT = 0x6c4cf0
const CROWN = 0xf2c94c
const LEAD_TOP = 0x1d1f26
const HEADSET = 0x26262e
const LEAD_SCALE = 1.12

export type Office3dLook = {
  sweater: number
  trim: number
  skin: number
  hair: number
  pants: number
  shoe: number
  knit: (typeof KNITS)[number]
  hairdo: (typeof HAIRDOS)[number]
  glasses: boolean
  beard: boolean
}

const shade = (hex: number, l: number): number => new THREE.Color(hex).offsetHSL(0, 0, l).getHex()
const pick = <T>(list: readonly T[], h: number, shift: number): T =>
  list[(h >>> shift) % list.length]!

/** A developer dressed as the Office sheet its Team list face wears, picked by `seed` (ORCA-1336). */
export function office3dLookOf(seed: string, role: Office3dRole): Office3dLook {
  const sheet =
    role === 'lead'
      ? OFFICE_LEAD_LOOK
      : role === 'advisor'
        ? OFFICE_ADVISOR_LOOK
        : teamSceneOfficeLookOf({ role: 'member', key: seed, characterKey: null })
  const h = Math.imul(teamSceneLookSeedOf(seed) + 7, 2654435761) >>> 0
  const sweater = role === 'steward' ? 0x5f8f4a : sheet.sweater
  return {
    sweater,
    // Why darker on a pale sweater: a lighter trim vanished on it.
    trim: shade(
      sweater,
      new THREE.Color(sweater).getHSL({ h: 0, s: 0, l: 0 }).l > 0.7 ? -0.28 : 0.16
    ),
    skin: sheet.skin,
    hair: sheet.hair,
    pants: sheet.pants,
    shoe: role === 'lead' ? LEAD_TOP : pick(SHOES, h, 27),
    // The sheets draw plain sweaters and one short cut; the lead's parting and turtleneck stay.
    knit: role === 'lead' ? 'turtle' : 'plain',
    hairdo: role === 'lead' ? 'part' : 'crop',
    glasses: false,
    beard: sheet.beard
  }
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cyl = (top: number, bottom: number, h: number, open = false) =>
  new THREE.CylinderGeometry(top, bottom, h, 14, 1, open)
const ball = (r: number, phi = Math.PI) =>
  new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, phi)

function knit(part: DioramaPart, L: Office3dLook, body: THREE.Object3D, lead: boolean): void {
  part(cyl(0.245, 0.25, 0.07), lead ? LEAD_TOP : L.trim, 0, -0.2, 0, body, { outline: false })
  if (L.knit === 'stripe') {
    part(cyl(0.218, 0.222, 0.08), L.trim, 0, 0.04, 0, body, { outline: false })
  } else if (L.knit === 'band2') {
    for (const y of [-0.02, 0.1]) {
      part(cyl(0.212, 0.216, 0.045), L.trim, 0, y, 0, body, { outline: false })
    }
  } else if (L.knit === 'cardigan') {
    part(box(0.11, 0.4, 0.04), 0xf2efe8, 0, 0, 0.215, body, { outline: false }).rotation.x = -0.08
    for (const y of [-0.1, 0, 0.1]) {
      part(new THREE.SphereGeometry(0.018, 6, 5), L.trim, 0.07, y, 0.235, body, { outline: false })
    }
  }
  if (L.knit === 'turtle') {
    part(cyl(0.12, 0.14, 0.12), lead ? LEAD_TOP : L.trim, 0, 0.27, 0, body)
  } else if (L.knit === 'collar') {
    for (const sx of [-1, 1]) {
      const c = part(box(0.1, 0.035, 0.08), 0xf6f4ee, sx * 0.07, 0.23, 0.13, body, {
        outline: false
      })
      c.rotation.set(0.3, 0, sx * -0.5)
    }
  } else {
    part(cyl(0.135, 0.15, 0.05), L.trim, 0, 0.23, 0, body, { outline: false })
  }
}

function hairdo(part: DioramaPart, L: Office3dLook, head: THREE.Group): void {
  const cap = (phi: number, r = 0.315) => {
    part(ball(r, Math.PI * phi), L.hair, 0, 0.02, -0.02, head).rotation.x = -0.3
  }
  if (L.hairdo === 'beanie') {
    part(ball(0.32, Math.PI * 0.5), L.sweater, 0, 0.05, 0, head).rotation.x = -0.12
    part(cyl(0.325, 0.325, 0.08), L.trim, 0, 0.08, 0.01, head, { outline: false })
    part(new THREE.SphereGeometry(0.07, 10, 6), L.trim, 0, 0.38, -0.04, head)
    return
  }
  if (L.hairdo === 'curly') {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      const y = 0.17 + Math.sin(k * 1.7) * 0.03
      part(
        new THREE.SphereGeometry(0.12, 12, 8),
        L.hair,
        Math.cos(a) * 0.2,
        y,
        Math.sin(a) * 0.2 - 0.04,
        head
      )
    }
    part(new THREE.SphereGeometry(0.15, 12, 8), L.hair, 0, 0.27, -0.02, head)
    return
  }
  cap(
    L.hairdo === 'buzz' ? 0.44 : L.hairdo === 'long' ? 0.56 : 0.52,
    L.hairdo === 'buzz' ? 0.308 : 0.315
  )
  if (L.hairdo === 'crop') {
    part(box(0.34, 0.07, 0.1), L.hair, 0.04, 0.2, 0.22, head).rotation.z = -0.15
  } else if (L.hairdo === 'part') {
    part(new THREE.SphereGeometry(0.15, 12, 8), L.hair, -0.12, 0.2, 0.15, head).scale.set(
      1.3,
      0.55,
      0.9
    )
  } else if (L.hairdo === 'bun') {
    part(new THREE.SphereGeometry(0.12, 12, 8), L.hair, 0, 0.3, -0.16, head)
  } else if (L.hairdo === 'long') {
    part(box(0.5, 0.48, 0.13), L.hair, 0, -0.12, -0.2, head)
  } else if (L.hairdo === 'pony') {
    part(cyl(0.07, 0.04, 0.34), L.hair, 0, -0.06, -0.33, head).rotation.x = 0.35
  }
}

function face(part: DioramaPart, L: Office3dLook, head: THREE.Group): void {
  part(new THREE.SphereGeometry(0.3, 18, 14), L.skin, 0, 0, 0, head)
  for (const ex of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), dioramaFlat(0x1b1815))
    eye.scale.set(0.8, 1.25, 0.6)
    eye.position.set(ex, 0, 0.275)
    head.add(eye)
    const cheek = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 10),
      dioramaFlat(0xf09a8a, { transparent: true, opacity: 0.5 })
    )
    cheek.position.set(ex * 1.7, -0.08, 0.262)
    cheek.rotation.y = ex * 2.7
    head.add(cheek)
  }
  if (L.beard) {
    part(new THREE.SphereGeometry(0.17, 12, 8), L.hair, 0, -0.18, 0.12, head).scale.set(
      1.15,
      0.8,
      0.7
    )
  }
  if (L.glasses) {
    const rim = dioramaFlat(0x1f2228)
    for (const ex of [-0.1, 0.1]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 6, 16), rim)
      lens.position.set(ex, 0, 0.29)
      head.add(lens)
    }
  }
}

/** The crown the lead wears on its Office sheet. */
function crown(part: DioramaPart, head: THREE.Group): void {
  const c = new THREE.Group()
  c.name = 'crown'
  c.position.set(0, 0.3, -0.02)
  head.add(c)
  part(cyl(0.17, 0.19, 0.08, true), CROWN, 0, 0, 0, c)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2
    part(
      new THREE.ConeGeometry(0.04, 0.1, 6),
      CROWN,
      Math.cos(a) * 0.17,
      0.09,
      Math.sin(a) * 0.17,
      c
    )
  }
}

/** A headset over the head with a mic toward the mouth: the lead and Jev talk to the team. */
function headset(part: DioramaPart, head: THREE.Group, mic: number): void {
  part(new THREE.TorusGeometry(0.33, 0.022, 6, 20, Math.PI), HEADSET, 0, 0.05, 0, head, {
    outline: false
  })
  part(cyl(0.08, 0.08, 0.07), HEADSET, -0.33, 0.02, 0, head).rotation.z = Math.PI / 2
  part(box(0.025, 0.025, 0.26), HEADSET, -0.27, -0.1, 0.14, head, { outline: false }).rotation.y =
    -0.5
  part(new THREE.SphereGeometry(0.035, 8, 6), mic, -0.2, -0.12, 0.25, head, { outline: false })
}

/** A developer on the diorama's skeleton, at the diorama's 1.6 scale; the lead a little larger. */
export function office3dDev(seed: string, role: Office3dRole): DioramaFigure {
  const part = dioramaParts(false)
  const L = office3dLookOf(seed, role)
  const lead = role === 'lead'
  const g = new THREE.Group()
  const legs: THREE.Group[] = []
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Group()
    leg.position.set(sx, 0.34, 0)
    g.add(leg)
    part(box(0.13, 0.28, 0.15), L.pants, 0, -0.14, 0, leg)
    part(box(0.15, 0.08, 0.23), L.shoe, 0, -0.29, 0.03, leg)
    part(box(0.155, 0.03, 0.235), L.trim, 0, -0.335, 0.03, leg, {
      outline: false
    })
    legs.push(leg)
  }
  const body = part(cyl(0.2, 0.24, 0.44), lead ? LEAD_TOP : L.sweater, 0, 0.56, 0, g)
  knit(part, L, body, lead)
  const arms: THREE.Group[] = []
  for (const sx of [-0.27, 0.27]) {
    const arm = new THREE.Group()
    arm.position.set(sx, 0.74, 0)
    g.add(arm)
    part(box(0.11, 0.3, 0.12), L.sweater, 0, -0.15, 0, arm)
    part(box(0.12, 0.06, 0.13), L.trim, 0, -0.31, 0, arm, { outline: false })
    part(new THREE.SphereGeometry(0.065, 14, 10), L.skin, 0, -0.37, 0, arm)
    arms.push(arm)
  }
  if (lead) {
    // Why short and open: a long coat hid the legs, so the lead read as standing in a skirt.
    const coat = part(cyl(0.235, 0.29, 0.5, true), L.sweater, 0, 0.55, -0.01, g)
    coat.material = (coat.material as THREE.Material).clone()
    ;(coat.material as THREE.Material).side = THREE.DoubleSide
    for (const sx of [-1, 1]) {
      const lapel = part(box(0.09, 0.34, 0.03), L.trim, sx * 0.1, 0.66, 0.2, g, {
        outline: false
      })
      lapel.rotation.set(-0.12, 0, sx * 0.32)
    }
  }
  const head = new THREE.Group()
  head.position.set(0, 1.08, 0)
  g.add(head)
  face(part, L, head)
  hairdo(part, L, head)
  if (lead || role === 'advisor') {
    headset(part, head, lead ? L.trim : 0x9ad8d8)
  }
  if (lead) {
    crown(part, head)
  }
  let tool: THREE.Group | null = null
  if (role === 'steward') {
    tool = new THREE.Group()
    tool.position.set(0, -0.4, 0.1)
    arms[0]!.add(tool)
    part(box(0.24, 0.32, 0.03), 0x2a2f3a, 0, 0, 0.04, tool)
    part(box(0.2, 0.27, 0.01), 0x7fb4ff, 0, 0, 0.06, tool, { outline: false })
  }
  g.scale.setScalar(DIORAMA_UNIT_SCALE * (lead ? LEAD_SCALE : 1))
  return { g, legs, arms, body, head, tool, bodyY: 0.56, baseY: 0, part }
}
