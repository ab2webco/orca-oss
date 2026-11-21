import * as THREE from 'three'
import type { Office3dFloor } from '../../../../shared/team-scene/team-office3d-layout'

// Why a floor of its own: a chip sized in world units shrank with the building, so at a 219 px
// panel the floor names could not be read (owner, ORCA-1302).

/** The smallest a floor's chip is drawn on screen, in CSS px tall; ~12 px text in it. */
export const OFFICE3D_LABEL_MIN_PX = 20
/** The chip's height in world units at the default zoom, as the diorama's island chips. */
const CHIP_UNITS = 0.62
const MAX_NAME = 14

/** The floor's chip text: its machine and desks used, or that it cannot be reached. */
export function office3dLabelOf(
  floor: Pick<Office3dFloor, 'lead' | 'name' | 'reachable' | 'used' | 'seats' | 'lobby'>,
  words: { thisMachine: string; offline: string; lobby?: string }
): string {
  // The shared ground floor has no machine and no desks to count.
  if (floor.lobby) {
    return words.lobby ?? 'Lobby'
  }
  const raw = floor.lead && !floor.name ? words.thisMachine : floor.name
  // Why cut the name, never the count: the count is what says whether the machine is full.
  const name = raw.length > MAX_NAME ? `${raw.slice(0, MAX_NAME - 1)}…` : raw
  return floor.reachable
    ? `${name} · ${floor.used}/${floor.seats.length}`
    : `${name} · ${words.offline}`
}

/**
 * The chip's world scale so it is never under `OFFICE3D_LABEL_MIN_PX` on screen. `pxPerUnit` is
 * how many CSS px one world unit takes at the camera's zoom; `aspect` is the chip's width/height.
 */
export function office3dLabelScale(pxPerUnit: number, aspect: number): [number, number] {
  const h = Math.max(CHIP_UNITS, OFFICE3D_LABEL_MIN_PX / Math.max(pxPerUnit, 1e-6))
  return [h * aspect, h]
}

/** Keeps `chip` legible for the camera's current px per world unit. */
export function keepOffice3dLabelLegible(chip: THREE.Sprite, pxPerUnit: number): void {
  const aspect = chip.userData.aspect ?? chip.scale.x / chip.scale.y
  chip.userData.aspect = aspect
  const [w, h] = office3dLabelScale(pxPerUnit, aspect)
  chip.scale.set(w, h, 1)
}

/**
 * Slides each floor chip back inside the camera's frame, along the screen's right and up, so no
 * chip is cut by the band's edge: following the lead, the frame shows only part of the building,
 * and a chip hung from a slab can fall outside it (owner, 410 x 760 panel).
 */
export function keepOffice3dChipsInFrame(
  chips: readonly THREE.Sprite[],
  camera: THREE.OrthographicCamera
): void {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const halfW = camera.right / camera.zoom
  const halfH = camera.top / camera.zoom
  const cx = camera.position.dot(right)
  const cy = camera.position.dot(up)
  const margin = Math.min(halfW, halfH) * 0.03
  const into = (lo: number, size: number, min: number, max: number) =>
    size > max - min ? min - lo : lo < min ? min - lo : lo + size > max ? max - (lo + size) : 0
  for (const chip of chips) {
    const base = (chip.userData.base as THREE.Vector3 | undefined) ?? chip.position.clone()
    chip.userData.base = base
    // Anchored at its top-left corner (center 0, 1): it spans right and down from there.
    const left = base.dot(right)
    const top = base.dot(up)
    const dx = into(left, chip.scale.x, cx - halfW + margin, cx + halfW - margin)
    const dy = into(top - chip.scale.y, chip.scale.y, cy - halfH + margin, cy + halfH - margin)
    chip.position.copy(base).addScaledVector(right, dx).addScaledVector(up, dy)
  }
}
