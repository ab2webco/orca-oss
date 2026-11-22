import * as THREE from 'three'
import {
  office3dLobbyOf,
  type Office3dFloor
} from '../../../../shared/team-scene/team-office3d-layout'
import type { DioramaKit } from './team-diorama-kit'
import { office3dChair, type Office3dPalette } from './team-office3d-floor'
import { office3dCanvas, paintOffice3dTv } from './team-office3d-screens'

// Why the ground floor: the owner wants an office's rhythm, members riding down for a coffee or a
// game when they have nothing to do, so the rooms are shared and the lift is part of it (ORCA-1317).

const yawTo = (from: [number, number], to: [number, number]) =>
  Math.atan2(to[0] - from[0], to[1] - from[1])

/** The lobby's cafeteria and games room on top of its bare floor; positions from office3dLobbyOf. */
export function office3dLobby(
  k: DioramaKit,
  X: Office3dPalette,
  floor: Office3dFloor
): THREE.Group {
  const { mesh, box, mat } = k
  const L = office3dLobbyOf(floor.width)
  const g = new THREE.Group()
  g.position.y = floor.y
  // The cafeteria: a counter with a coffee machine, and two tables with a chair each side.
  const c = L.counter
  mesh(box(c.w, 1, c.d), mat(X.deskSide), c.x, 0.5, c.z, g)
  mesh(box(c.w + 0.1, 0.08, c.d + 0.1), mat(X.deskTop), c.x, 1.04, c.z, g)
  mesh(box(0.45, 0.6, 0.4), mat(X.metal), c.x - 0.7, 1.38, c.z, g)
  for (const [x, z] of L.tables) {
    mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18), mat(X.deskTop), x, 0.78, z, g)
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 8), mat(X.metal), x, 0.39, z, g)
    mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), mat(0xffffff), x + 0.15, 0.87, z, g)
  }
  for (const seat of L.cafe) {
    // Why π from the facing: office3dChair faces -z, its back toward +z.
    office3dChair(k, X, g, seat.at[0], seat.at[1], yawTo(seat.at, seat.face) + Math.PI)
  }
  // The games room: a generic console under a TV (its screen is office3dLobbyTv), a couch, table tennis.
  const [tx, tz] = L.tv
  mesh(box(2.2, 1.25, 0.08), mat(X.monitor), tx, 1.75, tz, g)
  mesh(box(1.6, 0.45, 0.45), mat(X.deskSide), tx, 0.23, tz + 0.15, g)
  mesh(box(0.5, 0.1, 0.32), mat(0xe8e8ec), tx, 0.5, tz + 0.15, g)
  const couch = L.couch
  mesh(box(couch.w, 0.45, couch.d), mat(0x4a5d8c), couch.x, 0.23, couch.z, g)
  mesh(box(couch.w, 0.6, 0.18), mat(0x3e4f78), couch.x, 0.62, couch.z + couch.d / 2 - 0.09, g)
  for (const sx of [-1, 1]) {
    mesh(box(0.16, 0.6, couch.d), mat(0x3e4f78), couch.x + sx * (couch.w / 2), 0.38, couch.z, g)
  }
  const p = L.pingpong
  mesh(box(p.w, 0.06, p.d), mat(0x1f6b4f), p.x, 0.76, p.z, g)
  mesh(box(p.w + 0.02, 0.02, 0.04), mat(0xffffff), p.x, 0.8, p.z, g)
  mesh(box(0.03, 0.16, p.d), mat(0xe8e8ec), p.x, 0.87, p.z, g)
  for (const sx of [-1, 1]) {
    mesh(box(0.08, 0.74, 0.08), mat(X.metal), p.x + sx * (p.w / 2 - 0.2), 0.37, p.z, g)
  }
  // A doormat where members come in from the street and leave.
  mesh(box(1.2, 0.02, 0.6), mat(0x5a4636), L.door[0], 0.01, L.door[1], g, false)
  return g
}

const TV_REPAINT = 1 / 12

/** Whether anyone sits at a console seat on floor `floor` this frame (`office3dRoomCountOf`). */
export const office3dConsolePlayed = (here: ReadonlySet<string>, floor: number): boolean =>
  here.has(`console:${floor}:0`) || here.has(`console:${floor}:1`)

/** The TV's screen: a game in motion while a member plays at the console, dark otherwise. */
export function office3dLobbyTv(
  k: DioramaKit,
  floor: Office3dFloor,
  index: number,
  here: (t: number) => ReadonlySet<string>
): { group: THREE.Group; tick: (t: number) => void } {
  const [tx, tz] = office3dLobbyOf(floor.width).tv
  const g = new THREE.Group()
  g.position.y = floor.y
  const screen = office3dCanvas(256, 140)
  const face = screen ? k.basic(0xffffff, { map: screen.tex }) : k.basic(0x0b0f18)
  k.mesh(new THREE.PlaneGeometry(2.05, 1.12), face, tx, 1.75, tz + 0.05, g, false)
  let shown = -Infinity
  let was: boolean | null = null
  const tick = (t: number) => {
    const playing = office3dConsolePlayed(here(t), index)
    // Why only on a change while off: a dark screen needs no repaint each frame.
    if (playing === was && (!playing || (t - shown < TV_REPAINT && t >= shown))) {
      return
    }
    shown = t
    was = playing
    screen?.redraw((c, w, h) => paintOffice3dTv(c, w, h, playing, t))
  }
  return { group: g, tick }
}
