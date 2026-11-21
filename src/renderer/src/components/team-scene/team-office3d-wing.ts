import * as THREE from 'three'
import {
  OFFICE3D_DEPTH as D,
  OFFICE3D_HEIGHT as H,
  OFFICE3D_WING_WIDTH as AW,
  type Office3dFloor
} from '../../../../shared/team-scene/team-office3d-layout'
import type { DioramaKit } from './team-diorama-kit'
import { OFFICE3D_LEAD_COAT } from './team-office3d-dev'
import { office3dChair, type Office3dPalette } from './team-office3d-floor'
import { office3dCanvas, type Office3dCanvas } from './team-office3d-screens'

// Why rooms of their own: the lead works from its office and Jev from its control room (owner,
// ORCA-1302). Each machine runs its own Jev, so a floor whose Jev has not spoken has no room: an
// empty dark room would read as Jev being down, which is not true.

export type Office3dWing = { group: THREE.Group; wall: Office3dCanvas | null }

const glass = () =>
  new THREE.MeshStandardMaterial({
    color: 0xbfe0f0,
    transparent: true,
    opacity: 0.2,
    roughness: 0.1,
    depthWrite: false
  })

/** A glass side to the office with a door gap, and its frame. */
function glassSide(
  k: DioramaKit,
  X: Office3dPalette,
  parent: THREE.Object3D,
  h: number,
  depth: number,
  door: boolean
): void {
  const spans = door
    ? [
        [0, 3.4],
        [4.7, depth]
      ]
    : [[0, depth]]
  for (const [z0, z1] of spans) {
    k.mesh(
      k.box(0.05, h - 0.2, z1! - z0!),
      glass(),
      0.02,
      (h - 0.2) / 2,
      (z0! + z1!) / 2,
      parent,
      false
    )
    for (const z of [z0!, z1!]) {
      k.mesh(k.box(0.1, h, 0.1), k.mat(X.frame), 0.02, h / 2, z, parent)
    }
  }
}

/** The lead's office: glass to the floor, a desk facing the room, shelves and guest chairs. */
export function office3dLeadOffice(
  k: DioramaKit,
  X: Office3dPalette,
  floor: Office3dFloor
): THREE.Group {
  const { mesh, box, mat } = k
  const g = new THREE.Group()
  g.position.set(floor.width, floor.y, 0)
  mesh(box(AW, 0.14, D + 0.3), mat(X.floor), AW / 2, -0.07, D / 2 - 0.15, g, false)
  mesh(box(AW, 0.55, D + 0.3), mat(X.slab), AW / 2, -0.41, D / 2 - 0.15, g, false)
  mesh(box(3, 0.03, 3.4), mat(0x8a4f63), AW / 2, 0.015, 2.8, g, false)
  mesh(box(AW + 0.3, H + 1.1, 0.3), mat(X.wall), AW / 2 + 0.15, (H + 1.1) / 2, -0.15, g)
  glassSide(k, X, g, H + 1.1, D, true)
  const shelf = new THREE.Group()
  shelf.position.set(AW / 2 - 0.5, 0, 0.3)
  g.add(shelf)
  const books = [0x8e3b46, 0x2f4a7a, 0xd9a441, 0x3f7a5a, 0xe8dcc4, OFFICE3D_LEAD_COAT]
  mesh(box(2.6, 2.2, 0.05), mat(X.trim), 0, 1.1, -0.18, shelf)
  for (let r = 0; r < 3; r++) {
    mesh(box(2.6, 0.07, 0.42), mat(X.deskSide), 0, 0.03 + r * 0.66, 0, shelf)
    for (let b = 0; b < 9; b++) {
      mesh(
        box(0.14, 0.4 + ((r + b) % 3) * 0.05, 0.26),
        mat(books[(r * 3 + b) % books.length]!),
        -1.1 + b * 0.18,
        0.3 + r * 0.66,
        0.04,
        shelf
      )
    }
  }
  // The desk faces the room so the lead is seen from the front, with its name plate.
  const [dx, dz] = [AW / 2, 2.6]
  mesh(box(2.1, 0.09, 0.95), mat(0x7a4f32), dx, 0.98, dz, g)
  mesh(box(2, 0.88, 0.08), mat(0x6a4329), dx, 0.5, dz + 0.42, g)
  mesh(box(0.9, 0.56, 0.06), mat(X.monitor), dx - 0.35, 1.38, dz - 0.15, g)
  for (const gx of [-0.65, 0.65]) {
    mesh(box(0.6, 0.12, 0.6), mat(X.chair), dx + gx, 0.48, dz + 1.25, g)
  }
  // The lead's own chair behind the desk, facing the room, where its round ends.
  office3dChair(k, X, g, dx, dz - 0.95, Math.PI)
  return g
}

/** A floor's control room, or null where its Jev has not spoken. */
export function office3dControlRoom(
  k: DioramaKit,
  X: Office3dPalette,
  floor: Office3dFloor,
  night: boolean
): Office3dWing | null {
  const room = floor.controlRoom
  if (!room) {
    return null
  }
  const { mesh, box, mat } = k
  const g = new THREE.Group()
  g.position.set(room.x, room.y, 0)
  const depth = room.balcony ? 3.1 : D
  const h = room.balcony ? 3.5 : H + 0.3
  mesh(box(AW, 0.14, depth), mat(night ? 0x222833 : 0x3e4858), AW / 2, -0.07, depth / 2, g, false)
  mesh(
    box(AW, room.balcony ? 0.3 : 0.55, depth),
    mat(X.slab),
    AW / 2,
    room.balcony ? -0.29 : -0.41,
    depth / 2,
    g,
    false
  )
  mesh(box(AW + 0.3, h, 0.3), mat(night ? 0x262c37 : 0x39414e), AW / 2 + 0.15, h / 2, -0.15, g)
  glassSide(k, X, g, h, depth, !room.balcony)
  if (room.balcony) {
    mesh(box(AW, 0.9, 0.04), glass(), AW / 2, 0.45, depth, g, false)
    // The spiral stair from the lead's office, in the back corner where it hides nobody.
    for (let s = 0; s < 18; s++) {
      const a = -Math.PI / 2 + (s / 17) * Math.PI * 2.5
      const step = mesh(
        box(0.5, 0.06, 0.26),
        mat(X.metal),
        AW - 0.6 + Math.sin(a) * 0.25,
        -room.y + floor.y + ((s + 1) / 18) * (room.y - floor.y),
        0.85 + Math.cos(a) * 0.25,
        g
      )
      step.rotation.y = a - Math.PI / 2
    }
  }
  // The video wall: every member of this floor in Orca's status colours, and the console.
  const wall = office3dCanvas(400, 200)
  if (wall) {
    mesh(
      new THREE.PlaneGeometry(3.36, 1.68),
      k.basic(0xffffff, { map: wall.tex }),
      AW / 2,
      2.3,
      0.05,
      g,
      false
    )
  }
  mesh(box(AW - 0.6, 0.08, 0.85), mat(0x2f3540), AW / 2, 0.98, 1, g)
  // The advisor's chair at the console, turned as it sits.
  office3dChair(k, X, g, room.chair[0] - room.x, room.chair[1], -0.35)
  mesh(box(AW - 0.7, 0.5, 0.05), mat(0x232831), AW / 2, 0.68, 0.6, g)
  if (night) {
    k.glow(g, AW / 2, 2.3, 0.4, 0x5ee0e0, 3.2, 0.35)
  }
  return { group: g, wall }
}
