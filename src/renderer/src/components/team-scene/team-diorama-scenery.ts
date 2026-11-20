import * as THREE from 'three'
import type { DioramaPoint, DioramaRect } from '../../../../shared/team-scene/team-diorama-layout'
import type { DioramaTick } from './team-diorama-buildings'
import type { DioramaKit } from './team-diorama-kit'

// Why a port: islands, trees, rocks, roads, docks, the sailboat and the gulls are the approved
// prototype's (island, tree, rock, pathSeg, travelDock, sailboat, gulls; ORCA-1296).

/** An island: grass on dirt on a sand rim, with tufts in two greens. */
export function dioramaIsland(k: DioramaKit, rect: DioramaRect, parent: THREE.Object3D) {
  const { x, z, hw, hd } = rect
  const [w, d] = [hw * 2, hd * 2]
  k.mesh(k.box(w, 0.22, d), k.mat(k.p.grass), x, -0.11, z, parent, false)
  k.mesh(k.box(w - 0.05, 0.7, d - 0.05), k.mat(k.p.dirt), x, -0.55, z, parent, false)
  k.mesh(k.box(w + 0.9, 0.3, d + 0.9), k.mat(k.p.sand), x, -0.78, z, parent, false)
  const tuft = new THREE.ConeGeometry(0.07, 0.16, 4)
  const m4 = new THREE.Matrix4()
  for (const [hex, n] of [
    [k.p.grassDark, 70],
    [k.p.grassLight, 50]
  ] as const) {
    const im = new THREE.InstancedMesh(tuft, k.mat(hex), n)
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(x + (k.rnd() - 0.5) * (w - 0.6), 0.07, z + (k.rnd() - 0.5) * (d - 0.6))
      im.setMatrixAt(i, m4)
    }
    im.receiveShadow = true
    parent.add(im)
  }
}

export function dioramaTree(
  k: DioramaKit,
  x: number,
  z: number,
  s: number,
  pine: boolean,
  parent: THREE.Object3D
) {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.scale.setScalar(s)
  parent.add(g)
  k.mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.6, 6), k.mat(k.p.trunk), 0, 0.3, 0, g)
  if (pine) {
    k.mesh(new THREE.ConeGeometry(0.6, 1, 7), k.mat(k.p.leaf2), 0, 0.95, 0, g)
    k.mesh(new THREE.ConeGeometry(0.45, 0.8, 7), k.mat(k.p.leaf), 0, 1.4, 0, g)
    k.mesh(new THREE.ConeGeometry(0.28, 0.55, 7), k.mat(k.p.leaf3), 0, 1.8, 0, g)
  } else {
    k.mesh(new THREE.IcosahedronGeometry(0.6, 0), k.mat(k.p.leaf), 0, 1.05, 0, g)
    k.mesh(new THREE.IcosahedronGeometry(0.42, 0), k.mat(k.p.leaf3), 0.22, 1.35, 0.12, g)
    k.mesh(new THREE.IcosahedronGeometry(0.38, 0), k.mat(k.p.leaf2), -0.25, 0.92, -0.1, g)
  }
  return g
}

export function dioramaRock(k: DioramaKit, parent: THREE.Object3D, x: number, z: number, s = 0.3) {
  const r = k.mesh(new THREE.DodecahedronGeometry(s, 0), k.mat(k.p.rock), x, s * 0.5, z, parent)
  r.rotation.set(k.rnd() * 3, k.rnd() * 3, 0)
}

/** A road: flat path segments 0.75 wide, as the prototype paves them. */
export function dioramaRoad(
  k: DioramaKit,
  pts: readonly DioramaPoint[],
  parent: THREE.Object3D,
  width = 0.75
) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!
    const [bx, bz] = pts[i + 1]!
    const seg = k.mesh(
      k.box(width, 0.03, Math.hypot(bx - ax, bz - az)),
      k.mat(k.p.path),
      (ax + bx) / 2,
      0.015,
      (az + bz) / 2,
      parent,
      false
    )
    seg.rotation.y = Math.atan2(bx - ax, bz - az)
  }
}

/** A dock of planks from (x, z) out over the water along `dirZ`, on two pairs of posts. */
export function dioramaTravelDock(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  z: number,
  len: number,
  dirZ: 1 | -1
) {
  // Why a group: a newly connected island builds its dock plank by plank out of the water.
  const g = new THREE.Group()
  g.userData.dock = true
  parent.add(g)
  let n = 0
  for (let s = 0.12; s < len; s += 0.3) {
    const tone = n++ % 2 ? k.p.wood : 0xc89463
    k.mesh(k.box(1, 0.08, 0.27), k.mat(tone), x, -0.04, z + dirZ * s, g, false)
  }
  for (const s of [0.5, len - 0.2]) {
    for (const side of [-0.48, 0.48]) {
      k.mesh(k.box(0.1, 1.1, 0.1), k.mat(k.p.woodDark), x + side, -0.45, z + dirZ * s, g)
    }
  }
  return g
}

/** A short dock on posts, as a fisher sits at the end of. */
export function dioramaDock(
  k: DioramaKit,
  parent: THREE.Object3D,
  x: number,
  z: number,
  len: number
): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  parent.add(g)
  k.mesh(k.box(1, 0.08, len), k.mat(k.p.wood), 0, -0.04, len / 2, g)
  for (let s = 0.4; s < len; s += 0.9) {
    for (const side of [-0.46, 0.46]) {
      k.mesh(k.box(0.1, 1, 0.1), k.mat(k.p.woodDark), side, -0.5, s, g)
    }
  }
  return g
}

/** A sailboat circling off the island. */
export function dioramaSailboat(
  k: DioramaKit,
  parent: THREE.Object3D,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  speed: number
): DioramaTick {
  const g = new THREE.Group()
  parent.add(g)
  k.mesh(k.box(1.5, 0.32, 0.55), k.mat(0x8a5a3a), 0, -0.72, 0, g)
  k.mesh(k.box(1.1, 0.12, 0.45), k.mat(0xc89463), 0, -0.53, 0, g)
  k.mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), k.mat(k.p.woodDark), 0.1, 0.25, 0, g)
  const sailGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.12, 0.95, 0),
    new THREE.Vector3(0.12, -0.3, 0),
    new THREE.Vector3(0.85, -0.3, 0)
  ])
  sailGeo.computeVertexNormals()
  const sailMat = k.mat(0xf4efe4, { unique: true })
  sailMat.side = THREE.DoubleSide
  k.mesh(sailGeo, sailMat, 0, 0, 0, g)
  const wake = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 24, 1, Math.PI * 0.6, Math.PI * 0.8),
    k.basic(0xffffff, { transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  )
  wake.rotation.x = -Math.PI / 2
  wake.position.y = -0.78
  g.add(wake)
  return (t) => {
    const a = t * speed
    g.position.set(cx + Math.cos(a) * rx, Math.sin(t * 1.3) * 0.04, cz + Math.sin(a) * rz)
    g.rotation.y = Math.atan2(-Math.cos(a) * rz, -Math.sin(a) * rx) + Math.PI / 2
    g.rotation.z = Math.sin(t * 1.1) * 0.05
  }
}

/** Gulls wheeling over the home island. */
export function dioramaGulls(
  k: DioramaKit,
  parent: THREE.Object3D,
  cx: number,
  cz: number,
  n: number
): DioramaTick {
  const wing = k.basic(0xf7f7f7, { side: THREE.DoubleSide })
  const birds = Array.from({ length: n }, () => {
    const g = new THREE.Group()
    parent.add(g)
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), wing)
    l.position.x = -0.2
    const r = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.1), wing)
    r.position.x = 0.2
    g.add(l, r)
    return [g, l, r, k.rnd() * 6, 3 + k.rnd() * 3] as const
  })
  return (t) =>
    birds.forEach(([g, l, r, p, rad]) => {
      const a = t * 0.25 + p
      g.position.set(
        cx + Math.cos(a) * rad,
        5.5 + Math.sin(t * 0.7 + p) * 0.4,
        cz + Math.sin(a) * rad
      )
      g.rotation.y = -a
      const f = Math.sin(t * 5 + p) * 0.45
      l.rotation.z = f
      r.rotation.z = -f
    })
}
