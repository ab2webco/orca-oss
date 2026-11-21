import * as THREE from 'three'
import {
  OFFICE3D_AISLE_Z,
  OFFICE3D_DEPTH as D,
  OFFICE3D_DOOR_Z,
  OFFICE3D_HEIGHT as H,
  OFFICE3D_PITCH,
  OFFICE3D_SEAT_Z,
  type Office3dFloor
} from '../../../../shared/team-scene/team-office3d-layout'
import type { DioramaKit } from './team-diorama-kit'
import { office3dCanvas, type Office3dCanvas } from './team-office3d-screens'

// Why lofts: each machine is a floor whose back wall rises to the slab above with a high window
// band, so the boards over the desks are never hidden by the floor overhead (ORCA-1302 prototype).

/** The office's own materials, by theme; an unreachable floor draws them nearly grey. */
export const OFFICE3D_DAY = {
  floor: 0xd2bd96,
  seam: 0xbfa880,
  rug: 0x5d7690,
  slab: 0xc9c0ae,
  slabDark: 0x9a917f,
  wall: 0xf1e8d8,
  wallLow: 0xe3d6bf,
  trim: 0x6e4a2c,
  frame: 0x3e4a5c,
  deskTop: 0xd9b98a,
  deskSide: 0xb07c4c,
  metal: 0x3b4250,
  chair: 0x3c4a66,
  monitor: 0x1b1f27,
  coat: 0x8a5a3a,
  leaf: 0x4f9050,
  pot: 0xd9d4c8
}
export type Office3dPalette = typeof OFFICE3D_DAY
export const OFFICE3D_NIGHT: Office3dPalette = {
  ...OFFICE3D_DAY,
  floor: 0x7d6c55,
  seam: 0x6d5e4a,
  rug: 0x2f4256,
  slab: 0x83807a,
  slabDark: 0x5f5c57,
  wall: 0xa49c8e,
  wallLow: 0x948a7a,
  trim: 0x3e2a19,
  frame: 0x262e3b,
  deskTop: 0x8f7552,
  deskSide: 0x6e5034,
  chair: 0x2a3348,
  coat: 0x5a3a26,
  leaf: 0x2c4c34,
  pot: 0x9c968a
}

/** A desk's live surfaces: its monitor and its board, repainted by the stage. */
export type Office3dDesk = {
  group: THREE.Group
  screen: Office3dCanvas | null
  board: Office3dCanvas | null
}
export type Office3dFloorMeshes = { group: THREE.Group; desks: Office3dDesk[]; doors: THREE.Mesh[] }

/** A sky through the window band: dusk with lit windows at night, a clear day otherwise. */
function sky(night: boolean, grey: boolean): Office3dCanvas | null {
  const c = office3dCanvas(512, 128)
  c?.redraw((g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, grey ? '#3a3d44' : night ? '#141a3d' : '#79b9e4')
    grad.addColorStop(1, grey ? '#5a5d63' : night ? '#b86a78' : '#dcefF8')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    for (let x = 0, k = 0; x < w; k++) {
      const bw = 18 + ((k * 37) % 26)
      const bh = h * (0.35 + ((k * 53) % 40) / 100)
      g.fillStyle = grey ? '#44474d' : night ? '#23274a' : '#9ab8cc'
      g.fillRect(x, h - bh, bw, bh)
      x += bw + 2
    }
  })
  return c
}

/** How far behind the seat line a desk's chair stands; its sitter sits on it. */
export const OFFICE3D_CHAIR_BACK = 0.08

/** An office chair facing -z (rotate it with `yaw`): cushion, back and stem. */
export function office3dChair(
  k: DioramaKit,
  X: Office3dPalette,
  parent: THREE.Object3D,
  x: number,
  z: number,
  yaw: number
): THREE.Group {
  const { mesh, box, mat } = k
  const chair = new THREE.Group()
  chair.position.set(x, 0, z)
  chair.rotation.y = yaw
  parent.add(chair)
  mesh(new THREE.CylinderGeometry(0.4, 0.38, 0.12, 14), mat(X.chair), 0, 0.52, 0, chair)
  mesh(box(0.74, 0.74, 0.12), mat(X.chair), 0, 1, 0.42, chair)
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), mat(X.metal), 0, 0.26, 0, chair)
  return chair
}

function desk(
  k: DioramaKit,
  X: Office3dPalette,
  parent: THREE.Object3D,
  x: number,
  scale: number,
  taken: boolean
): Office3dDesk {
  const { mesh, box, mat } = k
  const g = new THREE.Group()
  g.position.set(x, 0, OFFICE3D_SEAT_Z)
  g.scale.setScalar(scale)
  parent.add(g)
  mesh(box(2, 0.08, 1.1), mat(X.deskTop), 0, 0.98, -0.95, g)
  for (const dx of [-0.92, 0.92]) {
    mesh(box(0.08, 0.94, 1.02), mat(X.deskSide), dx, 0.47, -0.95, g)
  }
  mesh(box(0.62, 0.04, 0.2), mat(0x2a2f3a), 0, 1.04, -0.68, g)
  mesh(box(0.08, 0.32, 0.08), mat(X.metal), 0, 1.18, -1.22, g)
  mesh(box(1.22, 0.78, 0.07), mat(X.monitor), 0, 1.62, -1.2, g)
  const screen = office3dCanvas(112, 72)
  const board = office3dCanvas(152, 96)
  if (screen) {
    mesh(
      new THREE.PlaneGeometry(1.12, 0.68),
      k.basic(0xffffff, { map: screen.tex }),
      0,
      1.62,
      -1.16,
      g,
      false
    )
  }
  if (board) {
    const b = new THREE.MeshBasicMaterial({ map: board.tex, transparent: true })
    mesh(new THREE.PlaneGeometry(1.3, 0.82), b, 0, 2.5, -OFFICE3D_SEAT_Z / scale + 0.03, g, false)
  }
  // The chair seen from behind; another session's desk has a coat over its back.
  const chair = office3dChair(k, X, g, 0, OFFICE3D_CHAIR_BACK, 0)
  if (taken) {
    mesh(box(0.66, 0.58, 0.1), mat(X.coat), 0, 1.02, 0.5, chair)
  }
  return { group: g, screen, board }
}

/** One machine's floor: slab, walls, window band, lift door, desks, and its haze when offline. */
export function office3dFloor(
  k: DioramaKit,
  floor: Office3dFloor,
  topFloor: boolean,
  night: boolean
): Office3dFloorMeshes {
  const X = night ? OFFICE3D_NIGHT : OFFICE3D_DAY
  const { mesh, box, mat } = k
  const group = new THREE.Group()
  group.position.y = floor.y
  const W = floor.width
  const HW = topFloor ? H + 1.6 : OFFICE3D_PITCH - 0.86
  mesh(box(W + 0.3, 0.14, D + 0.3), mat(X.floor), W / 2 - 0.15, -0.07, D / 2 - 0.15, group, false)
  mesh(box(W + 0.3, 0.55, D + 0.3), mat(X.slab), W / 2 - 0.15, -0.41, D / 2 - 0.15, group, false)
  mesh(
    box(W + 0.05, 0.18, D + 0.05),
    mat(X.slabDark),
    W / 2 - 0.15,
    -0.77,
    D / 2 - 0.15,
    group,
    false
  )
  for (let x = 1.1; x < W; x += 1.1) {
    mesh(box(0.03, 0.01, D), mat(X.seam), x, 0.005, D / 2, group, false)
  }
  mesh(box(W - 1.4, 0.03, 1.9), mat(X.rug), W / 2 + 0.2, 0.015, OFFICE3D_AISLE_Z, group, false)
  // The back wall to the slab above, a dado, and the window band over the boards.
  mesh(box(W + 0.3, H + 0.3, 0.3), mat(X.wall), W / 2 - 0.15, (H + 0.3) / 2, -0.15, group)
  mesh(box(W + 0.3, 1, 0.04), mat(X.wallLow), W / 2 - 0.15, 0.5, 0.02, group, false)
  mesh(box(W + 0.3, 0.07, 0.07), mat(X.trim), W / 2 - 0.15, 1.02, 0.04, group)
  const band = HW - 0.4 - (H + 0.3)
  const view = sky(night, !floor.reachable)
  if (view) {
    const pane = k.basic(0xffffff, { map: view.tex })
    mesh(
      new THREE.PlaneGeometry(W + 0.3, band),
      pane,
      W / 2 - 0.15,
      H + 0.3 + band / 2,
      -0.24,
      group,
      false
    )
  }
  mesh(box(W + 0.3, 0.4, 0.3), mat(X.wall), W / 2 - 0.15, HW - 0.2, -0.15, group)
  // The side wall with the lift door: two leaves the stage slides open while someone rides.
  mesh(
    box(0.3, HW, OFFICE3D_DOOR_Z - 0.85),
    mat(X.wall),
    -0.15,
    HW / 2,
    (OFFICE3D_DOOR_Z - 0.85) / 2,
    group
  )
  mesh(box(0.3, HW - 2.8, 1.7), mat(X.wall), -0.15, 2.8 + (HW - 2.8) / 2, OFFICE3D_DOOR_Z, group)
  const doors = [-1, 1].map((side) =>
    mesh(
      box(0.08, 2.75, 0.84),
      mat(0xb9c2cc, { metal: 0.3, rough: 0.4 }),
      -0.08,
      1.38,
      OFFICE3D_DOOR_Z + side * 0.42,
      group
    )
  )
  const desks = floor.seats.map((seat) =>
    desk(k, X, group, seat.x, floor.scale, seat.kind === 'taken')
  )
  if (!floor.reachable) {
    for (let q = 0; q < 9; q++) {
      const puff = new THREE.IcosahedronGeometry(0.6 + k.rnd() * 0.5, 1)
      mesh(
        puff,
        mat(k.p.fog, { opacity: k.p.fogOpacity * 0.45, unique: true }),
        k.rnd() * W,
        0.8 + k.rnd() * 1.6,
        k.rnd() * D,
        group,
        false
      )
    }
  }
  return { group, desks, doors }
}
