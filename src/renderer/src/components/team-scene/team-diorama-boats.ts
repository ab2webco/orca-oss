import * as THREE from 'three'
import type { DioramaPoint } from '../../../../shared/team-scene/team-diorama-layout'
import { DIORAMA_UNIT_SCALE } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'

// Why a boat per home dock: the lead never walks on water; it rows from a dock (owner, ORCA-1296).

export type DioramaBoat = {
  g: THREE.Group
  place: (at: DioramaPoint, heading: DioramaPoint | null, t: number, moving: boolean) => void
}

/** Where the sea's surface is; the boat grows with the figures about it, so it still floats. */
const SEA = -0.95
/** The lead's seat height in the boat, at the figures' size. */
export const DIORAMA_BOAT_SEAT = -0.6 * DIORAMA_UNIT_SCALE

/** The prototype's rowboat (makeBoat): hull, rims, stern, bow, a thwart and two bladed oars. */
export function dioramaBoat(k: DioramaKit, parent: THREE.Object3D): DioramaBoat {
  const outer = new THREE.Group()
  parent.add(outer)
  const g = new THREE.Group()
  g.scale.setScalar(DIORAMA_UNIT_SCALE)
  g.position.y = SEA * (1 - DIORAMA_UNIT_SCALE)
  outer.add(g)
  const hull = 0x8a5a3a,
    rim = 0xc89463
  k.mesh(k.box(0.86, 0.2, 1.7), k.mat(hull), 0, -0.86, 0, g)
  for (const sx of [-0.45, 0.45]) {
    k.mesh(k.box(0.08, 0.3, 1.7), k.mat(rim), sx, -0.7, 0, g)
  }
  k.mesh(k.box(0.86, 0.3, 0.08), k.mat(rim), 0, -0.7, -0.85, g)
  const bow = k.mesh(new THREE.ConeGeometry(0.48, 0.55, 4, 1), k.mat(hull), 0, -0.78, 1.1, g)
  bow.rotation.set(Math.PI / 2, Math.PI / 4, 0)
  bow.scale.set(1, 1, 0.55)
  k.mesh(k.box(0.86, 0.05, 0.26), k.mat(rim), 0, -0.62, -0.25, g)
  const oars: [THREE.Group, number][] = []
  for (const sx of [-1, 1]) {
    const oar = new THREE.Group()
    oar.position.set(sx * 0.48, -0.6, -0.1)
    g.add(oar)
    k.mesh(k.box(0.05, 0.05, 1.3), k.mat(0x6e4a2c), sx * 0.45, -0.1, 0, oar).rotation.z = sx * 0.35
    k.mesh(k.box(0.06, 0.18, 0.3), k.mat(0x6e4a2c), sx * 0.95, -0.34, 0, oar)
    oars.push([oar, sx])
  }
  const wake = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 24, 1, Math.PI * 1.15, Math.PI * 0.7),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    })
  )
  wake.rotation.x = -Math.PI / 2
  wake.position.set(0, -0.92, -0.6)
  g.add(wake)
  let heading: DioramaPoint = [0, 1]
  return {
    g: outer,
    place: (at, next, t, moving) => {
      if (next && Math.hypot(next[0], next[1]) > 1e-6) {
        heading = next
      }
      outer.position.set(at[0], Math.sin(t * 1.4) * 0.03, at[1])
      outer.rotation.y = Math.atan2(heading[0], heading[1])
      outer.rotation.z = Math.sin(t * 1.1) * 0.03
      for (const [oar, sx] of oars) {
        oar.rotation.x = moving ? Math.sin(t * 3.2) * 0.6 : 0.2
        oar.rotation.y = moving ? sx * Math.cos(t * 3.2) * 0.25 : 0
      }
      wake.visible = moving
    }
  }
}
