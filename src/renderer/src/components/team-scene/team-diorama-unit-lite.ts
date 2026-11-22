import * as THREE from 'three'
import type { DioramaKit } from './team-diorama-kit'
import type { DioramaPart } from './team-diorama-unit-parts'
import type { TeamSceneFigureLook } from '../../../../shared/team-scene/team-scene-member-looks'
import { dioramaGear, type DioramaUnit } from './team-diorama-units'

// Why its own model: Low resources draws the prototype's low-poly unit (makeUnitLite), a few
// faceted parts with no outline, not the toon figure with its outline turned off (ORCA-1296).

/** The prototype's `makeUnitLite`. */
export function dioramaLiteUnit(
  k: DioramaKit,
  part: DioramaPart,
  look: TeamSceneFigureLook
): DioramaUnit {
  const g = new THREE.Group()
  const { tunic, skin } = look
  const legs: THREE.Group[] = []
  const arms: THREE.Group[] = []
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Group()
    leg.position.set(sx, 0.34, 0)
    g.add(leg)
    part(new THREE.BoxGeometry(0.13, 0.34, 0.15), look.pants, 0, -0.17, 0, leg)
    legs.push(leg)
  }
  const body = part(new THREE.CylinderGeometry(0.19, 0.25, 0.44, 6), tunic, 0, 0.56, 0, g)
  for (const sx of [-0.27, 0.27]) {
    const arm = new THREE.Group()
    arm.position.set(sx, 0.74, 0)
    g.add(arm)
    part(new THREE.BoxGeometry(0.11, 0.38, 0.12), tunic, 0, -0.18, 0, arm)
    arms.push(arm)
  }
  const head = new THREE.Group()
  head.position.set(0, 1.08, 0)
  g.add(head)
  part(new THREE.IcosahedronGeometry(0.29, 0), skin, 0, 0, 0, head)
  for (const ex of [-0.1, 0.1]) {
    part(new THREE.BoxGeometry(0.05, 0.07, 0.03), 0x1b1815, ex, 0, 0.26, head)
  }
  liteHat(part, look, head)
  const u: DioramaUnit = { g, legs, arms, body, head, tool: null, bodyY: 0.56 }
  dioramaGear(k, part, look, u)
  return u
}

/** One faceted shape per headwear, so each member still reads apart at Low resources. */
function liteHat(part: DioramaPart, look: TeamSceneFigureLook, head: THREE.Group): void {
  const { headwear, headwearColor: hw, trim, hair } = look
  const name = `headwear:${headwear}`
  const hat = (geo: THREE.BufferGeometry, hex: number, x: number, y: number, z: number) => {
    part(geo, hex, x, y, z, head).name = name
  }
  if (headwear !== 'helm' && headwear !== 'hood') {
    part(new THREE.IcosahedronGeometry(0.3, 0), hair, 0, 0.04, -0.07, head)
  }
  if (headwear === 'wizard') {
    hat(new THREE.ConeGeometry(0.3, 0.6, 6), hw, 0, 0.42, 0)
  } else if (headwear === 'crown') {
    hat(new THREE.CylinderGeometry(0.21, 0.23, 0.13, 6), hw, 0, 0.33, 0)
  } else if (headwear === 'helm') {
    hat(new THREE.DodecahedronGeometry(0.32, 0), hw, 0, 0.06, 0)
    hat(new THREE.BoxGeometry(0.06, 0.2, 0.32), trim, 0, 0.38, -0.05)
  } else if (headwear === 'hood') {
    hat(new THREE.IcosahedronGeometry(0.33, 0), hw, 0, 0.05, -0.06)
    hat(new THREE.BoxGeometry(0.5, 0.3, 0.12), hw, 0, -0.2, -0.2)
  } else if (headwear === 'headband') {
    hat(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 6), hw, 0, 0.1, 0)
  } else if (headwear === 'cap') {
    hat(new THREE.CylinderGeometry(0.26, 0.31, 0.16, 6), hw, 0, 0.2, 0)
    hat(new THREE.ConeGeometry(0.05, 0.36, 4), trim, 0.06, 0.42, -0.12)
  } else {
    hat(new THREE.BoxGeometry(0.4, 0.3, 0.16), hair, 0, -0.16, -0.16)
  }
  if (look.beard !== null) {
    part(new THREE.OctahedronGeometry(0.17, 0), look.beard, 0, -0.24, 0.13, head).name = 'beard'
  }
}
