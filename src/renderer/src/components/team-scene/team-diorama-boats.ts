import * as THREE from 'three'
import type { DioramaPoint } from '../../../../shared/team-scene/team-diorama-layout'
import type { DioramaKit } from './team-diorama-kit'

// Why a boat per home dock: the lead never walks on water; it rows from a dock (owner, ORCA-1296).

export type DioramaBoat = {
  g: THREE.Group
  place: (at: DioramaPoint, heading: DioramaPoint | null, t: number, moving: boolean) => void
}

/** A rowboat with two oars that pull while it moves, and a wake behind it. */
export function dioramaBoat(k: DioramaKit, parent: THREE.Object3D): DioramaBoat {
  const g = new THREE.Group()
  parent.add(g)
  const hull = 0x8a5a3a,
    rim = 0xc89463
  k.mesh(k.box(0.86, 0.2, 1.7), k.mat(hull), 0, -0.86, 0, g)
  for (const sx of [-0.45, 0.45]) {
    k.mesh(k.box(0.08, 0.3, 1.7), k.mat(rim), sx, -0.7, 0, g)
  }
  k.mesh(k.box(0.86, 0.05, 0.26), k.mat(rim), 0, -0.62, -0.25, g)
  const oars: [THREE.Group, number][] = []
  for (const sx of [-1, 1]) {
    const oar = new THREE.Group()
    oar.position.set(sx * 0.48, -0.6, -0.1)
    g.add(oar)
    k.mesh(k.box(0.05, 0.05, 1.3), k.mat(k.p.woodDark), sx * 0.45, -0.1, 0, oar).rotation.z =
      sx * 0.35
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
    g,
    place: (at, next, t, moving) => {
      if (next && Math.hypot(next[0], next[1]) > 1e-6) {
        heading = next
      }
      g.position.set(at[0], Math.sin(t * 1.4) * 0.03, at[1])
      g.rotation.y = Math.atan2(heading[0], heading[1])
      for (const [oar, sx] of oars) {
        oar.rotation.x = moving ? Math.sin(t * 3.2) * 0.6 : 0.2
        oar.rotation.y = moving ? sx * Math.cos(t * 3.2) * 0.25 : 0
      }
      wake.visible = moving
    }
  }
}
