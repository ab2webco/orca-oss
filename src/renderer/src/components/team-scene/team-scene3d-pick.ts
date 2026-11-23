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

// A figure is about 1.2 wide at the arms; the ring sits just inside that, under its feet.
const RING_RADIUS = 0.6
const RING_GAP = 0.05

/** A ring on the surface the lit figure stands on, under its feet, never reaching a neighbour. */
export function scene3dHoverMark(parent: THREE.Object3D, color: string) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 1, 40),
    // Why depth-tested: drawn over everything, its far arc crossed the figure's waist.
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
  )
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 10
  ring.visible = false
  parent.add(ring)
  const at = new THREE.Vector3()
  const other = new THREE.Vector3()
  const box = new THREE.Box3()
  return {
    ring,
    place: (figure: THREE.Object3D | null, others: Iterable<THREE.Object3D> = []) => {
      ring.visible = figure !== null
      if (!figure) {
        return
      }
      figure.getWorldPosition(at)
      // Why the box: the figure's lowest point is the booth or desk floor it stands on.
      const base = Math.max(box.setFromObject(figure).min.y, at.y)
      let radius = RING_RADIUS
      for (const o of others) {
        if (o !== figure && o.visible) {
          o.getWorldPosition(other)
          radius = Math.min(radius, Math.hypot(other.x - at.x, other.z - at.z) / 2 - RING_GAP)
        }
      }
      ring.scale.setScalar(Math.max(radius, 0.25))
      ring.position.copy(parent.worldToLocal(at.setY(base + 0.03)))
    }
  }
}
