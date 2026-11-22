import * as THREE from 'three'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'

// Why one palette per theme: day lights the diorama, night lights its windows (ORCA-1296).

export type DioramaPalette = typeof DAY
export const DAY = {
  sea: 0x4f9fc0,
  seaDeep: 0x3f8aa8,
  sand: 0xe2cf9f,
  grass: 0x78a656,
  grassDark: 0x5f8c44,
  grassLight: 0x8db866,
  dirt: 0x9a7350,
  dirtDark: 0x7a5a3d,
  path: 0xdcc597,
  pad: 0xc49a6c,
  stone: 0xe6e0d3,
  stone2: 0xc9c0ae,
  stoneDark: 0x9a917f,
  plaster: 0xf1e8d8,
  timber: 0x6e4a2c,
  roof: 0x4f5e75,
  roof2: 0x3e4a5c,
  wood: 0xb07c4c,
  woodDark: 0x6e4a2c,
  leaf: 0x4f9050,
  leaf2: 0x3d7a43,
  leaf3: 0x6aae58,
  trunk: 0x6b4a2f,
  rock: 0xa7a59f,
  canvas: 0xefe7d6,
  window: 0x3c4654,
  lit: false,
  hemiSky: 0xd6e8f5,
  hemiGround: 0x7a6c4c,
  hemi: 0.5,
  sun: 0xfff0d6,
  sunI: 1.45,
  banner: 0xf7f5ef,
  fog: 0xffffff,
  fogOpacity: 0.62
}
export const NIGHT: DioramaPalette = {
  ...DAY,
  sea: 0x14324a,
  seaDeep: 0x0f2638,
  sand: 0x6d6450,
  grass: 0x35553a,
  grassDark: 0x2a4630,
  grassLight: 0x41653f,
  dirt: 0x4a3a2c,
  dirtDark: 0x3a2d22,
  path: 0x6f6550,
  pad: 0x5d4a37,
  stone: 0x9c9a96,
  stone2: 0x83807a,
  stoneDark: 0x5f5c57,
  plaster: 0xa49c8e,
  timber: 0x3e2a19,
  roof: 0x2f3949,
  roof2: 0x262e3b,
  wood: 0x6e5034,
  woodDark: 0x3e2a19,
  leaf: 0x2c4c34,
  leaf2: 0x223e2b,
  leaf3: 0x36593b,
  trunk: 0x3e2a19,
  rock: 0x6f6e6a,
  canvas: 0xb8ad97,
  window: 0xffd98c,
  lit: true,
  hemiSky: 0x3a5a8c,
  hemiGround: 0x101820,
  hemi: 0.55,
  sun: 0xa9c1ff,
  sunI: 0.62,
  fog: 0x3b4352,
  fogOpacity: 0.72
}

type MatOptions = {
  emissive?: number | string
  ei?: number
  opacity?: number
  rough?: number
  metal?: number
  /** Its own material, for one that animates its colour or opacity. */
  unique?: boolean
}

// Why a drawn texture: the prototype's soft additive glow for lit things; a test DOM may lack 2D.
let glowTexture: THREE.Texture | null | undefined
function glowMap(): THREE.Texture | null {
  if (glowTexture !== undefined) {
    return glowTexture
  }
  const c = typeof document === 'undefined' ? null : document.createElement('canvas')
  const g = c?.getContext('2d') ?? null
  if (!c || !g) {
    return (glowTexture = null)
  }
  c.width = c.height = 64
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  glowTexture = new THREE.CanvasTexture(c)
  glowTexture.userData.shared = true
  return glowTexture
}

/** Shared geometry and materials for one world, as the approved prototype builds them. */
export function dioramaKit(p: DioramaPalette, status: TeamSceneStatusColors) {
  const mats = new Map<string, THREE.Material>()
  const mat = (hex: number | string, o: MatOptions = {}): THREE.MeshStandardMaterial => {
    const key = `${hex}|${o.emissive ?? ''}|${o.ei ?? ''}|${o.opacity ?? ''}|${o.rough ?? ''}|${o.metal ?? ''}`
    const known = o.unique ? undefined : mats.get(key)
    if (known) {
      return known as THREE.MeshStandardMaterial
    }
    const s = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: o.rough ?? 0.88,
      metalness: o.metal ?? 0,
      flatShading: true
    })
    if (o.emissive !== undefined) {
      s.emissive = new THREE.Color(o.emissive)
      s.emissiveIntensity = o.ei ?? 1
    }
    if (o.opacity !== undefined) {
      s.transparent = true
      s.opacity = o.opacity
      s.depthWrite = false
    }
    mats.set(o.unique ? `${key}|${mats.size}` : key, s)
    return s
  }
  /** Unlit, as the prototype's flames, lamps, wakes and sparks. */
  const basic = (hex: number | string, o: THREE.MeshBasicMaterialParameters = {}) =>
    new THREE.MeshBasicMaterial({ color: hex, ...o })
  const mesh = (
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
    shadow = true
  ) => {
    const out = new THREE.Mesh(geo, m)
    out.position.set(x, y, z)
    out.castShadow = shadow
    out.receiveShadow = true
    parent.add(out)
    return out
  }
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
  const glow = (
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    hex: number | string,
    size: number,
    strength = 1
  ) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap(),
        color: new THREE.Color(hex),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: strength
      })
    )
    s.position.set(x, y, z)
    s.scale.set(size, size, 1)
    parent.add(s)
    return s
  }
  const windowMat = () =>
    p.lit ? mat(p.window, { emissive: 0xffc870, ei: 1.1 }) : mat(p.window, { rough: 0.4 })
  // Why seeded: the same team draws the same tufts, rocks and flames on every read.
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  // Why its textures too: a material's dispose leaves its maps (screens, chips, the lift) on the
  // GPU, and a stage is rebuilt on every read; textures marked shared outlive every stage.
  const free = (material: THREE.Material) => {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture && !value.userData.shared) {
        value.dispose()
      }
    }
    material.dispose()
  }
  const dispose = (root: THREE.Object3D) => {
    // Why each mesh's own material too: figures and cues make their own, outside this kit's map.
    root.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      for (const one of [m.material ?? []].flat()) {
        free(one)
      }
    })
    for (const m of mats.values()) {
      free(m)
    }
  }
  return { p, status, mat, basic, mesh, box, glow, windowMat, rnd, dispose }
}
export type DioramaKit = ReturnType<typeof dioramaKit>

const greyed = (hex: number | string): number => {
  const hsl = { h: 0, s: 0, l: 0 }
  new THREE.Color(hex).getHSL(hsl)
  return new THREE.Color().setHSL(hsl.h, hsl.s * 0.12, hsl.l * 0.82 + 0.06).getHex()
}

/** The prototype's OFF palette: an unreachable machine's island and builds, nearly grey. */
export function dioramaOffKit(k: DioramaKit): DioramaKit {
  const p = Object.fromEntries(
    Object.entries(k.p).map(([key, v]) =>
      typeof v === 'number' && key !== 'sunI' && key !== 'hemi' && key !== 'fogOpacity'
        ? [key, greyed(v)]
        : [key, v]
    )
  ) as DioramaPalette
  const status = Object.fromEntries(
    Object.entries(k.status).map(([key, v]) => [
      key,
      `#${new THREE.Color(greyed(v)).getHexString()}`
    ])
  ) as TeamSceneStatusColors
  return dioramaKit({ ...p, lit: false }, status)
}
