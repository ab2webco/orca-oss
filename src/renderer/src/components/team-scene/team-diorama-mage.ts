import * as THREE from 'three'
import type { DioramaPoint } from '../../../../shared/team-scene/team-diorama-layout'
import {
  dioramaLeadJumpAt,
  type DioramaLeadRound
} from '../../../../shared/team-scene/team-diorama-lead-round'
import { DIORAMA_MAGE_LOOK, dioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import { poseDioramaFigure } from './team-diorama-poses'
import type { DioramaTick } from './team-diorama-props'

// Why a mage: on the Direct pace the lead does not walk; the court mage beside the keep sends it
// from circle to circle by magic (owner, ORCA-1296).

export const DIORAMA_MAGE: DioramaPoint = [-4, -1]
const VIOLET = 0x9b7bff

const glowing = (opacity: number) =>
  new THREE.MeshBasicMaterial({
    color: VIOLET,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  })

function circle(parent: THREE.Object3D) {
  const g = new THREE.Group()
  g.visible = false
  parent.add(g)
  const outer = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 40), glowing(0.9))
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.39, 6), glowing(0.9))
  for (const ring of [outer, inner]) {
    ring.rotation.x = -Math.PI / 2
    g.add(ring)
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 3.2, 20, 1, true), glowing(0))
  beam.position.y = 1.6
  g.add(beam)
  return { g, outer, inner, beam }
}

/** The mage at the keep, its staff's orb, and the two circles each jump glows through. */
export function dioramaMage(
  k: DioramaKit,
  parent: THREE.Object3D,
  round: DioramaLeadRound,
  lite: boolean
): DioramaTick {
  const mage = dioramaFigure(k, DIORAMA_MAGE_LOOK, { lite })
  mage.g.position.set(DIORAMA_MAGE[0], 0, DIORAMA_MAGE[1])
  parent.add(mage.g)
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glowing(0))
  orb.position.set(0.3, 1.55, 0.1)
  mage.g.add(orb)
  const circles = [circle(parent), circle(parent)]
  return (t) => {
    const jump = dioramaLeadJumpAt(round, t)
    const toward = jump ? (jump.k < 0.5 ? jump.from : jump.to) : null
    mage.g.rotation.y = toward
      ? Math.atan2(toward[0] - DIORAMA_MAGE[0], toward[1] - DIORAMA_MAGE[1])
      : Math.PI / 4
    poseDioramaFigure(mage, jump ? 'wave' : 'idle', t)
    ;(orb.material as THREE.MeshBasicMaterial).opacity = jump ? 0.9 : 0
    circles.forEach((c, n) => {
      const at = jump ? (n === 0 ? jump.from : jump.to) : null
      // The departure circle glows through the first half, the arrival circle through the second.
      const glow = jump ? 1 - Math.abs(jump.k - (n === 0 ? 0.3 : 0.7)) / 0.3 : 0
      c.g.visible = at !== null && glow > 0
      if (!at || !c.g.visible) {
        return
      }
      const e = Math.min(1, glow)
      c.g.position.set(at[0], 0.04, at[1])
      c.g.scale.setScalar(0.4 + e * 0.8)
      c.outer.rotation.z = t * 1.5
      c.inner.rotation.z = -t * 2.2
      ;(c.beam.material as THREE.MeshBasicMaterial).opacity = 0.4 * e
    })
  }
}
