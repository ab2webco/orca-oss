import type * as THREE from 'three'
import { OFFICE3D_LIFT, OFFICE3D_PITCH } from '../../../../shared/team-scene/team-office3d-layout'

// Why one pass per floor: the slabs cast no shadow (a ceiling's would darken every floor under it),
// so in one shadow map a member walking upstairs also shadowed the floor below (owner, ORCA-1317).

// How far under its floor's level a part may hang and still belong to it: a chip under the slab.
const HANG = 2

/** Marks `o` as drawn apart from every floor, after them: the lift shaft spans them all. */
export function office3dAcrossFloors(o: THREE.Object3D): void {
  o.userData.office3dAcross = true
}

/** The pass `o` is drawn in: its floor from its height, or the shaft's while it rides the cab. */
export function office3dPassOf(o: THREE.Object3D, floors: number): number {
  // A rider stands on the cab's floor, so its shadow falls there, never on a floor it passes.
  const riding =
    Math.abs(o.position.x - OFFICE3D_LIFT[0]) < 0.75 &&
    Math.abs(o.position.z - OFFICE3D_LIFT[1]) < 0.3
  if (o.userData.office3dAcross || riding) {
    return floors
  }
  const floor = Math.floor((o.position.y + HANG) / OFFICE3D_PITCH)
  return Math.min(floors - 1, Math.max(0, floor))
}

/**
 * Draws `world` one floor at a time, then what spans them, so each floor's shadow map holds only
 * what stands on that floor: nothing on one floor shadows another.
 */
export function office3dRenderByFloor(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  world: THREE.Object3D,
  camera: THREE.Camera,
  floors: number
): void {
  const parts = world.children.map((o) => ({
    o,
    shown: o.visible,
    pass: office3dPassOf(o, floors)
  }))
  renderer.autoClear = false
  renderer.clear()
  for (let pass = 0; pass <= floors; pass++) {
    if (!parts.some((p) => p.pass === pass && p.shown)) {
      continue
    }
    for (const p of parts) {
      p.o.visible = p.shown && p.pass === pass
    }
    renderer.render(scene, camera)
  }
  for (const p of parts) {
    p.o.visible = p.shown
  }
}
