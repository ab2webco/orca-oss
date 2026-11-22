import * as THREE from 'three'

// Why these parts: the approved prototype's figures are toon-shaded in three steps with an ink
// outline (an inverted hull about 0.028 units thick); Low resources draws flat Lambert parts.

let gradient: THREE.DataTexture | null = null
const gradientMap = (): THREE.DataTexture => {
  if (!gradient) {
    gradient = new THREE.DataTexture(
      new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]),
      3,
      1
    )
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter
    gradient.generateMipmaps = false
    gradient.needsUpdate = true
    gradient.userData.shared = true
  }
  return gradient
}

export type DioramaPartOptions = { emissive?: number; outline?: boolean }
export type DioramaPart = (
  geo: THREE.BufferGeometry,
  hex: number,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
  o?: DioramaPartOptions
) => THREE.Mesh

/** The prototype's `tpart` (toon with outline) or, under Low resources, its `lpart`. */
export function dioramaParts(lite: boolean): DioramaPart {
  const cache = new Map<string, THREE.Material>()
  const ink = new THREE.MeshBasicMaterial({ color: 0x1b1815, side: THREE.BackSide })
  const matOf = (hex: number, emissive?: number): THREE.Material => {
    const key = `${hex}|${emissive ?? ''}`
    let m = cache.get(key)
    if (!m) {
      if (lite) {
        m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true })
      } else {
        const toon = new THREE.MeshToonMaterial({ color: hex, gradientMap: gradientMap() })
        if (emissive !== undefined) {
          toon.emissive = new THREE.Color(emissive)
          toon.emissiveIntensity = 0.6
        }
        m = toon
      }
      cache.set(key, m)
    }
    return m
  }
  return (geo, hex, x, y, z, parent, o = {}) => {
    const m = new THREE.Mesh(geo, matOf(hex, lite ? undefined : o.emissive))
    m.position.set(x, y, z)
    m.castShadow = !lite
    parent.add(m)
    if (!lite && o.outline !== false) {
      geo.computeBoundingSphere()
      const outline = new THREE.Mesh(geo, ink)
      outline.scale.setScalar(1 + 0.028 / Math.max(0.05, geo.boundingSphere!.radius))
      m.add(outline)
    }
    return m
  }
}

/** The prototype's unlit material, for eyes, highlights, cheeks and glasses. */
export const dioramaFlat = (hex: number, o: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ color: hex, ...o })
