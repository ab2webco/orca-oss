import * as THREE from 'three'

// Why its own file: the phone's WebView draws the stage but has no hover store, so this stays
// free of zustand and React (ORCA-1336).

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
