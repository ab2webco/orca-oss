import * as THREE from 'three'

export const DIORAMA_VIEW = new THREE.Vector3(1, 0.88, 1).normalize()

export type DioramaFit = {
  camera: THREE.OrthographicCamera
  height: number
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
  maxHeight = 520
): DioramaFit {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  camera.position.copy(DIORAMA_VIEW).multiplyScalar(80)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const box = new THREE.Box3()
  world.updateMatrixWorld(true)
  world.traverse((o) => {
    const m = o as THREE.Mesh
    // Why not planes: the sea is a 600-wide plane and would fit the camera to the horizon.
    if (m.geometry && m.geometry.type !== 'PlaneGeometry') {
      box.expandByObject(m)
    }
  })
  const corners = [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) =>
      [box.min.z, box.max.z].map((z) =>
        new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
      )
    )
  )
  const xs = corners.map((v) => v.x)
  const ys = corners.map((v) => v.y)
  const fw = Math.max(...xs) - Math.min(...xs) + 1.6
  const fh = Math.max(...ys) - Math.min(...ys) + 1.6
  const height = Math.round(Math.max(240, Math.min(width * (fh / fw), maxHeight)))
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
  return { camera, height, ground: box, center: target, span: half.w * 2 }
}
