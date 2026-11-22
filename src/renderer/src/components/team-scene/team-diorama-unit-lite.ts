import * as THREE from 'three'
import type { DioramaKit } from './team-diorama-kit'
import type { DioramaPart } from './team-diorama-unit-parts'
import type { TeamSceneFigureLook } from '../../../../shared/team-scene/team-scene-member-looks'
import type { DioramaUnit } from './team-diorama-units'

// Why its own model: Low resources draws the prototype's low-poly unit (makeUnitLite), a few
// faceted parts with no outline, not the toon figure with its outline turned off (ORCA-1296).

/** The prototype's `makeUnitLite`. */
export function dioramaLiteUnit(
  k: DioramaKit,
  part: DioramaPart,
  look: TeamSceneFigureLook
): DioramaUnit {
  const g = new THREE.Group()
  const { tunic, skin, headwear, headwearColor } = look
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
  if (headwear === 'wizard') {
    part(new THREE.ConeGeometry(0.3, 0.6, 6), headwearColor, 0, 0.42, 0, head)
  } else if (headwear === 'crown') {
    part(new THREE.CylinderGeometry(0.21, 0.23, 0.13, 6), headwearColor, 0, 0.33, 0, head)
  }
  if (headwear !== 'wizard' && headwear !== 'crown') {
    const cover = headwear === 'hair' ? look.hair : headwearColor
    part(new THREE.IcosahedronGeometry(0.31, 0), cover, 0, 0.07, -0.05, head)
  } else {
    part(new THREE.IcosahedronGeometry(0.3, 0), look.hair, 0, 0.04, -0.07, head)
  }
  const u: DioramaUnit = { g, legs, arms, body, head, tool: null, bodyY: 0.56 }
  if (look.cape !== null) {
    part(new THREE.BoxGeometry(0.5, 0.7, 0.05), look.cape, 0, 0.5, -0.24, g)
  }
  if (look.tool === 'banner') {
    part(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 5), k.p.woodDark, -0.06, -0.05, 0.08, arms[0]!)
    const banner = part(new THREE.PlaneGeometry(0.42, 0.3), 0xf7f5ef, -0.29, 0.62, 0.08, arms[0]!)
    banner.material = (banner.material as THREE.Material).clone()
    ;(banner.material as THREE.Material).side = THREE.DoubleSide
  } else if (look.tool === 'hammer') {
    const tool = new THREE.Group()
    tool.position.set(0, -0.38, 0.05)
    arms[1]!.add(tool)
    part(new THREE.BoxGeometry(0.05, 0.05, 0.36), k.p.woodDark, 0, 0, 0.16, tool)
    part(new THREE.BoxGeometry(0.16, 0.12, 0.12), 0x8c8f94, 0, 0, 0.34, tool)
    u.tool = tool
  }
  return u
}
