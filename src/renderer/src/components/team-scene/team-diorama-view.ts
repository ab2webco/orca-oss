import * as THREE from 'three'
import { DIORAMA_VIEW, type DioramaFit } from './team-diorama-camera'

// Why a view that outlives the stage: each read rebuilds the stage, and the camera must stay where
// the viewer left it, or keep following the lead, without a jump (owner, ORCA-1296).

/** Following the lead (the default), framing the whole world, or where the viewer moved it. */
export type DioramaCameraMode = 'lead' | 'all' | 'free'

export type DioramaView = {
  mode: DioramaCameraMode
  target: THREE.Vector3 | null
  zoom: number
  goal: THREE.Vector3
  goalZoom: number
  unitsPerPx: number
  lastT: number | null
}

export const dioramaView = (): DioramaView => ({
  mode: 'lead',
  target: null,
  zoom: 1,
  goal: new THREE.Vector3(),
  goalZoom: 1,
  unitsPerPx: 0.05,
  lastT: null
})

const MIN_ZOOM = 0.8
const MAX_ZOOM = 5
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))

// The screen's right and up in the world, fixed by the isometric view.
const basis = (() => {
  const cam = new THREE.OrthographicCamera()
  cam.position.copy(DIORAMA_VIEW)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return {
    right: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0),
    up: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
  }
})()

function enterFree(view: DioramaView): void {
  if (view.mode === 'free') {
    return
  }
  view.mode = 'free'
  if (view.target) {
    view.goal.copy(view.target)
  }
  view.goalZoom = view.zoom
}

/** Drags the world under the pointer by `dx`, `dy` screen pixels; the viewer takes the camera. */
export function dioramaPan(view: DioramaView, dx: number, dy: number): void {
  enterFree(view)
  view.goal
    .addScaledVector(basis.right, -dx * view.unitsPerPx)
    .addScaledVector(basis.up, dy * view.unitsPerPx)
  view.target?.copy(view.goal)
}

/** Zooms by `factor` (above 1 is closer); the viewer takes the camera. */
export function dioramaZoomBy(view: DioramaView, factor: number): void {
  enterFree(view)
  view.goalZoom = clampZoom(view.goalZoom * factor)
}

/** The zoom that follows the lead: close enough to read a member, whatever the world's width. */
export const dioramaLeadZoom = (span: number): number => Math.max(1.2, Math.min(3, span / 16))

/**
 * Aims the camera for the frame at `t`: at the lead, at the whole world, or where the viewer left
 * it, easing there so a change of mode never jumps. The first frame of a view snaps.
 */
export function dioramaAim(
  view: DioramaView,
  fit: DioramaFit,
  lead: THREE.Vector3,
  widthPx: number,
  t: number
): void {
  const goal = view.mode === 'lead' ? lead : view.mode === 'all' ? fit.center : view.goal
  const goalZoom =
    view.mode === 'lead' ? dioramaLeadZoom(fit.span) : view.mode === 'all' ? 1 : view.goalZoom
  const dt = view.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - view.lastT))
  view.lastT = t
  if (!view.target) {
    view.target = goal.clone()
    view.zoom = goalZoom
  } else {
    const follow = 1 - (view.mode === 'lead' ? 0.06 : 0.002) ** dt
    view.target.lerp(goal, follow)
    view.zoom += (goalZoom - view.zoom) * follow
  }
  const camera = fit.camera
  camera.zoom = view.zoom
  camera.position.copy(view.target).addScaledVector(DIORAMA_VIEW, 80)
  camera.lookAt(view.target)
  camera.updateProjectionMatrix()
  view.unitsPerPx = (camera.right - camera.left) / camera.zoom / Math.max(1, widthPx)
}
