import * as THREE from 'three'

export const DIORAMA_VIEW = new THREE.Vector3(1, 0.88, 1).normalize()

export type DioramaFit = {
  camera: THREE.OrthographicCamera
  height: number
  /** The height that shows the whole world at this width, whatever height was asked for. */
  full: number
  /** The world's ground extent, for the sun's shadow box. */
  ground: THREE.Box3
  /** Where the camera looks to frame the whole world, and the width it frames. */
  center: THREE.Vector3
  span: number
}

/** An isometric camera that frames the whole world at `width`, and the stage height that fits it. */
export function dioramaFitCamera(
  world: THREE.Object3D,
  width: number,
  maxHeight = 760,
  minHeight = 220
): DioramaFit {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  camera.position.copy(DIORAMA_VIEW).multiplyScalar(80)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const box = new THREE.Box3()
  const corners: THREE.Vector3[] = []
  world.updateMatrixWorld(true)
  // Why each part's own box, solid ones only: the prototype's computeFit, so the frame hugs the
  // islands instead of the box around them, and fog, wakes and the sea never widen it.
  world.traverse((o) => {
    const m = o as THREE.Mesh
    const mat = m.material as THREE.Material | undefined
    if (!m.isMesh || !mat || mat.transparent || m.geometry.type === 'PlaneGeometry') {
      return
    }
    const part = new THREE.Box3().setFromObject(m)
    box.union(part)
    for (const x of [part.min.x, part.max.x]) {
      for (const y of [part.min.y, part.max.y]) {
        for (const z of [part.min.z, part.max.z]) {
          corners.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse))
        }
      }
    }
  })
  const xs = corners.map((v) => v.x)
  const ys = corners.map((v) => v.y)
  const fw = Math.max(...xs) - Math.min(...xs) + 1.6
  const fh = Math.max(...ys) - Math.min(...ys) + 1.6
  const full = Math.round(Math.max(220, Math.min(width * (fh / fw), 760)))
  const height = Math.round(Math.max(minHeight, Math.min(width * (fh / fw), maxHeight)))
  const aspect = width / height
  const half =
    fw / 2 / aspect > fh / 2
      ? { w: fw / 2, h: fw / 2 / aspect }
      : { w: (fh / 2) * aspect, h: fh / 2 }
  Object.assign(camera, { left: -half.w, right: half.w, top: half.h, bottom: -half.h })
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2
  const target = new THREE.Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .multiplyScalar(cx)
    .add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(cy))
  camera.position.copy(target).add(DIORAMA_VIEW.clone().multiplyScalar(80))
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  return { camera, height, full, ground: box, center: target, span: half.w * 2 }
}
