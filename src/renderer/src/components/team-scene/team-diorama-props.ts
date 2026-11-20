import * as THREE from 'three'
import {
  DIORAMA_FARM,
  type DioramaSpot
} from '../../../../shared/team-scene/team-diorama-activities'
import type { DioramaFigure } from './team-diorama-figures'
import type { DioramaKit } from './team-diorama-kit'
import type { DioramaPose } from './team-diorama-poses'
import { dioramaDock } from './team-diorama-scenery'

// Why a port: a free member fishes, waters or chops as the approved prototype's fisher, farm and
// chopper do, catch, drops and chips included (ORCA-1296).

export type { DioramaTick } from './team-diorama-buildings'
/** Animates an activity's props and says which pose its member plays now. */
export type DioramaPlay = (t: number) => DioramaPose

const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
const ROW_Z = DIORAMA_FARM.z + DIORAMA_FARM.hd + 0.45

function fisher(
  k: DioramaKit,
  spot: DioramaSpot,
  f: DioramaFigure,
  parent: THREE.Object3D,
  i: number
): DioramaPlay {
  const [x, z] = spot.at
  const len = Math.hypot(spot.face[0] - x, spot.face[1] - z) || 1
  const out = [(spot.face[0] - x) / len, (spot.face[1] - z) / len] as const
  dioramaDock(k, parent, x - out[0] * 2.4, z - out[1] * 2.4, 3).rotation.y = Math.atan2(
    out[0],
    out[1]
  )
  k.mesh(
    new THREE.CylinderGeometry(0.16, 0.13, 0.26, 10),
    k.mat(0x7a8a99),
    x - out[1] * 0.7,
    0.13,
    z + out[0] * 0.7,
    parent
  )
  const rod = new THREE.Group()
  rod.position.set(0, -0.36, 0.04)
  rod.rotation.x = -0.15
  f.arms[1]!.add(rod)
  const pole = f.part(new THREE.CylinderGeometry(0.018, 0.028, 2.1, 6), 0x5a3a22, 0, 1, 0, rod)
  const tip = new THREE.Object3D()
  tip.position.set(0, 1.05, 0)
  pole.add(tip)
  const bob = k.mesh(new THREE.SphereGeometry(0.09, 10, 8), k.mat(0xf2f2f2), 0, 0, 0, parent)
  k.mesh(
    new THREE.SphereGeometry(0.092, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    k.mat(0xd9534f),
    0,
    0,
    0,
    bob
  )
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3()
  ])
  parent.add(
    new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.7 })
    )
  )
  const fish = k.mesh(new THREE.SphereGeometry(0.13, 10, 8), k.mat(0x8fb3c9), 0, 0, 0, parent)
  fish.scale.set(1.6, 0.8, 0.6)
  k.mesh(new THREE.ConeGeometry(0.1, 0.16, 4), k.mat(0x7fa3b9), -0.26, 0, 0, fish).rotation.z =
    Math.PI / 2
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.14, 20),
    k.basic(0xffffff, { transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  )
  ring.rotation.x = -Math.PI / 2
  parent.add(ring)
  const at = [x + out[0] * 2.6 * 1.3, z + out[1] * 2.6 * 1.3] as const
  return (t) => {
    const ph = ((t + i * 3.1) % 11) / 11
    const catching = ph > 0.82
    const dip = ph > 0.74 && ph < 0.82 ? Math.sin(((ph - 0.74) / 0.08) * Math.PI * 3) * 0.07 : 0
    bob.position.set(at[0], -0.74 + Math.sin(t * 1.7) * 0.03 - Math.abs(dip), at[1])
    bob.visible = !catching
    const a = wp(tip)
    lineGeo.setFromPoints([
      a,
      catching ? a.clone().add(new THREE.Vector3(0, -0.5, 0)) : bob.position
    ])
    fish.visible = catching
    if (catching) {
      const c = (ph - 0.82) / 0.18
      fish.position.set(
        at[0] - out[0] * 1.6 * c,
        -0.6 + Math.sin(c * Math.PI) * 1.6,
        at[1] - out[1] * 1.6 * c
      )
      fish.rotation.set(0, Math.atan2(-out[1], out[0]) + Math.PI, Math.sin(t * 9) * 0.3)
    }
    const rk = (t * 0.6 + i) % 1
    ring.position.set(at[0], -0.74, at[1])
    ring.scale.setScalar(0.6 + rk * 2.2)
    ;(ring.material as THREE.Material).opacity = 0.55 * (1 - rk)
    return catching ? 'reel' : 'fish'
  }
}

function farmer(k: DioramaKit, f: DioramaFigure, parent: THREE.Object3D): DioramaPlay {
  const can = new THREE.Group()
  can.position.set(0, -0.4, 0.08)
  f.arms[1]!.add(can)
  f.part(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 10), 0x6f8fa8, 0, 0, 0.06, can)
  const sp = f.part(new THREE.CylinderGeometry(0.02, 0.03, 0.26, 6), 0x6f8fa8, 0, 0.06, 0.22, can)
  sp.rotation.x = 1.1
  const spout = new THREE.Object3D()
  spout.position.set(0, 0.14, 0)
  sp.add(spout)
  const drops = Array.from({ length: 7 }, () =>
    k.mesh(new THREE.SphereGeometry(0.03, 6, 5), k.basic(0x8fd0f0), 0, 0, 0, parent, false)
  )
  return (t) => {
    const nearRow = Math.abs(f.g.position.z - ROW_Z) < 0.25
    drops.forEach((m, n) => {
      m.visible = nearRow
      if (nearRow) {
        const o = wp(spout)
        const fall = (t * 1.6 + n / drops.length) % 1
        m.position.set(o.x + ((n % 3) - 1) * 0.03, o.y - fall * 0.75, o.z + 0.05 + fall * 0.12)
      }
    })
    return nearRow ? 'water' : 'walk'
  }
}

function chopper(
  k: DioramaKit,
  spot: DioramaSpot,
  f: DioramaFigure,
  parent: THREE.Object3D,
  i: number
): DioramaPlay {
  const [x, z] = spot.at
  const len = Math.hypot(spot.face[0] - x, spot.face[1] - z) || 1
  const [bx, bz] = [x + ((spot.face[0] - x) / len) * 1.1, z + ((spot.face[1] - z) / len) * 1.1]
  const stump = k.mesh(
    new THREE.CylinderGeometry(0.3, 0.34, 0.42, 10),
    k.mat(0x8a6240),
    bx,
    0.21,
    bz,
    parent
  )
  k.mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.02, 10), k.mat(0xc89463), 0, 0.22, 0, stump)
  const log = k.mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.32, 8),
    k.mat(0xb07c4c),
    bx,
    0.58,
    bz,
    parent
  )
  const axe = new THREE.Group()
  axe.position.set(0, -0.38, 0.05)
  f.arms[1]!.add(axe)
  f.part(new THREE.BoxGeometry(0.05, 0.05, 0.5), 0x6e4a2c, 0, 0, 0.22, axe)
  f.part(new THREE.BoxGeometry(0.04, 0.2, 0.16), 0xa9adb3, 0, -0.06, 0.44, axe)
  const chips = Array.from({ length: 5 }, () => {
    const m = k.mesh(k.box(0.06, 0.03, 0.08), k.mat(0xd9b27c), 0, 0, 0, parent, false)
    return [m, k.rnd() * Math.PI * 2] as const
  })
  return (t) => {
    const ph = (((t + i) * 2.2) / (Math.PI * 2)) % 1
    const hit = ph > 0.2 && ph < 0.55
    chips.forEach(([m, a]) => {
      m.visible = hit
      const c = (ph - 0.2) / 0.35
      m.position.set(
        bx + Math.cos(a) * c * 0.6,
        0.75 + Math.sin(c * Math.PI) * 0.35,
        bz + Math.sin(a) * c * 0.6
      )
      m.rotation.set(c * 6, a, 0)
    })
    log.scale.y = hit ? 0.92 : 1
    return 'chop'
  }
}

/** Gives a free member its tool and props; returns what it plays each frame at its spot. */
export function dioramaActivity(
  k: DioramaKit,
  spot: DioramaSpot,
  f: DioramaFigure,
  parent: THREE.Object3D,
  i: number
): DioramaPlay {
  if (spot.kind === 'fish') {
    return fisher(k, spot, f, parent, i)
  }
  if (spot.kind === 'farm') {
    return farmer(k, f, parent)
  }
  if (spot.kind === 'chop') {
    return chopper(k, spot, f, parent, i)
  }
  return () => 'sit'
}
