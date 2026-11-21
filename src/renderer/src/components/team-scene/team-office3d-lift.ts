import * as THREE from 'three'
import type { TeamSceneEmote } from '../../../../shared/team-scene/team-scene-types'
import {
  OFFICE3D_CALL_PANEL,
  OFFICE3D_DOOR_Z,
  OFFICE3D_HEIGHT,
  OFFICE3D_LIFT,
  OFFICE3D_PITCH
} from '../../../../shared/team-scene/team-office3d-layout'
import type { DioramaKit } from './team-diorama-kit'
import type { Office3dPalette } from './team-office3d-floor'
import { drawSceneEmote, type TeamSceneStatusColors } from './team-scene-painter-marks'

/** The glass shaft beside every floor's door, and the one cab that rides it. */
export function office3dLiftShaft(
  k: DioramaKit,
  X: Office3dPalette,
  floors: number
): { group: THREE.Group; cab: THREE.Group } {
  const { mesh, box, mat } = k
  const group = new THREE.Group()
  const top = (floors - 1) * OFFICE3D_PITCH + OFFICE3D_HEIGHT + 1.9
  const z0 = OFFICE3D_DOOR_Z - 1,
    z1 = OFFICE3D_DOOR_Z + 1,
    x0 = -2.25,
    x1 = -0.3
  const tall = top + 0.9
  for (const [px, pz] of [
    [x0, z0],
    [x0, z1],
    [x1, z0],
    [x1, z1]
  ] as const) {
    mesh(box(0.12, tall, 0.12), mat(X.frame), px, tall / 2 - 0.9, pz, group)
  }
  mesh(
    box(x1 - x0 + 0.3, 0.3, z1 - z0 + 0.3),
    mat(X.frame),
    (x0 + x1) / 2,
    top + 0.15,
    OFFICE3D_DOOR_Z,
    group
  )
  const glass = mat(0xbfe0f0, { opacity: 0.16, unique: true })
  for (const [w, d, px, pz] of [
    [0.04, z1 - z0, x0, OFFICE3D_DOOR_Z],
    [x1 - x0, 0.04, (x0 + x1) / 2, z1]
  ] as const) {
    mesh(box(w, tall, d), glass, px, tall / 2 - 0.9, pz, group, false)
  }
  const cab = new THREE.Group()
  const [cx, cz] = OFFICE3D_LIFT
  mesh(box(1.7, 0.12, 1.8), mat(X.metal), cx, -0.06, cz, cab)
  mesh(box(0.08, 2.9, 1.8), mat(X.metal), x0 + 0.12, 1.45, cz, cab)
  // Its far side: without it the open doorway looked through the cab at the sky.
  mesh(box(1.7, 2.9, 0.08), mat(X.metal), cx, 1.45, cz - 0.9, cab)
  mesh(box(1.7, 0.1, 1.8), mat(X.metal), cx, 2.95, cz, cab)
  mesh(box(1.2, 0.03, 1.2), k.basic(0xfff1c9), cx, 2.89, cz, cab, false)
  group.add(cab)
  return { group, cab }
}

const spriteOf = (draw: (g: CanvasRenderingContext2D) => void, w: number, h: number) => {
  const c = typeof document === 'undefined' ? null : document.createElement('canvas')
  const g = c?.getContext('2d')
  if (!c || !g) {
    return new THREE.Sprite()
  }
  c.width = w
  c.height = h
  draw(g)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  )
  s.renderOrder = 11
  s.center.set(0.5, 0)
  return s
}

/** A seated member's mark over its head, drawn as the 2D Office draws it. */
export function office3dMark(kind: TeamSceneEmote, colors: TeamSceneStatusColors): THREE.Sprite {
  const s = spriteOf(
    (g) => {
      g.scale(4, 4)
      drawSceneEmote(g, 8, 8, kind, colors)
    },
    64,
    80
  )
  s.scale.set(0.7, 0.875, 1)
  return s
}

/** The lead's violet chevron, so the lead is found at a glance at any width. */
export function office3dLeadMark(coat: number): THREE.Sprite {
  const s = spriteOf(
    (g) => {
      g.lineJoin = 'round'
      g.lineWidth = 14
      g.strokeStyle = '#ffffff'
      g.fillStyle = `#${coat.toString(16).padStart(6, '0')}`
      g.beginPath()
      for (const [x, y] of [
        [14, 26],
        [64, 70],
        [114, 26],
        [114, 62],
        [64, 112],
        [14, 62]
      ]) {
        g.lineTo(x, y)
      }
      g.closePath()
      g.stroke()
      g.fill()
    },
    128,
    128
  )
  s.scale.set(0.8, 0.8, 1)
  return s
}

/** The call panel on a floor's side wall by the lift door; `light` turns its button on or off. */
export function office3dCallPanel(
  k: DioramaKit,
  X: Office3dPalette,
  parent: THREE.Object3D,
  floor: number
): { button: THREE.Mesh; light: (on: boolean) => void } {
  const [px, pz] = OFFICE3D_CALL_PANEL
  k.mesh(k.box(0.06, 0.9, 0.55), k.mat(X.frame), px + 0.03, 1.35, pz, parent)
  const off = new THREE.Color(0x3a3f4a)
  const on = new THREE.Color(0xffb020)
  const material = new THREE.MeshBasicMaterial({ color: off })
  const button = k.mesh(k.box(0.05, 0.3, 0.3), material, px + 0.08, 1.45, pz, parent, false)
  button.userData.callButton = floor
  button.userData.lit = false
  return {
    button,
    light: (lit) => {
      button.userData.lit = lit
      material.color.copy(lit ? on : off)
    }
  }
}
