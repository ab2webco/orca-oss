import * as THREE from 'three'
import { useTeamSceneHover } from './team-scene-hit'

// Why the 2D scenes' store: a Team row lights its figure and a figure its row, in every scene
// (ORCA-1336); the 3D ones only add how to find a figure under the pointer and how to mark it.

type Point = { x: number; y: number }
type Size = { width: number; height: number }

/** The key of the figure drawn under `at` (canvas pixels), the nearest when two overlap. */
export function scene3dPick(
  camera: THREE.Camera,
  figures: ReadonlyMap<string, THREE.Object3D>,
  at: Point,
  size: Size
): string | null {
  const ray = new THREE.Raycaster()
  ray.setFromCamera(
    new THREE.Vector2((at.x / size.width) * 2 - 1, 1 - (at.y / size.height) * 2),
    camera
  )
  let best: { key: string; distance: number } | null = null
  for (const [key, figure] of figures) {
    if (!figure.visible) {
      continue
    }
    const hit = ray.intersectObject(figure, true)[0]
    if (hit && (!best || hit.distance < best.distance)) {
      best = { key, distance: hit.distance }
    }
  }
  return best?.key ?? null
}

/** A ring on the ground under the lit figure; drawn over everything, so a see-through one shows it. */
export function scene3dHoverMark(parent: THREE.Object3D, color: string) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.9, 32),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })
  )
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 10
  ring.visible = false
  parent.add(ring)
  return {
    ring,
    place: (figure: THREE.Object3D | null) => {
      ring.visible = figure !== null
      if (figure) {
        const at = figure.getWorldPosition(new THREE.Vector3())
        ring.position.set(at.x, at.y + 0.04, at.z)
      }
    }
  }
}

/** Below this many pixels between press and click, a click is a click and not a drag's end. */
const CLICK_PX = 4

/**
 * Wires a 3D scene's canvas to the hover store: the figure under the pointer lights its row, the
 * row under the pointer marks its figure (`light`), and a click opens the figure as its row does.
 */
export function linkScene3dHover(args: {
  el: EventTarget & { getBoundingClientRect: () => DOMRect }
  pick: (at: Point, size: Size) => string | null
  light: (key: string | null) => void
  open: (key: string) => void
}): () => void {
  const { el, pick, light, open } = args
  let own: string | null = null
  let down: Point | null = null
  const hitAt = (e: Event): string | null => {
    const { clientX, clientY } = e as MouseEvent
    const r = el.getBoundingClientRect()
    return pick({ x: clientX - r.left, y: clientY - r.top }, { width: r.width, height: r.height })
  }
  const point = (key: string | null) => {
    // Why only our own: leaving the stage keeps a row the Team list is lighting.
    if (key !== own && (key !== null || useTeamSceneHover.getState().key === own)) {
      useTeamSceneHover.getState().set(key)
    }
    own = key
  }
  const handlers: [string, (e: Event) => void][] = [
    ['pointermove', (e) => (e as PointerEvent).pointerType !== 'touch' && point(hitAt(e))],
    ['pointerleave', () => point(null)],
    ['pointerdown', (e) => (down = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })],
    [
      'click',
      (e) => {
        const { clientX, clientY } = e as MouseEvent
        const still = down && Math.hypot(clientX - down.x, clientY - down.y) < CLICK_PX
        down = null
        const key = still ? hitAt(e) : null
        if (key) {
          open(key)
        }
      }
    ]
  ]
  for (const [type, fn] of handlers) {
    el.addEventListener(type, fn)
  }
  light(useTeamSceneHover.getState().key)
  const unsubscribe = useTeamSceneHover.subscribe((s) => light(s.key))
  return () => {
    unsubscribe()
    for (const [type, fn] of handlers) {
      el.removeEventListener(type, fn)
    }
  }
}
