import * as THREE from 'three'
import type { TeamSceneStatusColors } from './team-scene-painter-marks'

// Why one palette per theme: day lights the diorama, night lights its windows (ORCA-1296).

export type DioramaPalette = typeof DAY
export const DAY = {
  sea: 0x4f9fc0,
  sand: 0xe2cf9f,
  grass: 0x78a656,
  grassDark: 0x5f8c44,
  grassLight: 0x8db866,
  dirt: 0x9a7350,
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
  sand: 0x6d6450,
  grass: 0x35553a,
  grassDark: 0x2a4630,
  grassLight: 0x41653f,
  dirt: 0x4a3a2c,
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

/** Shared geometry and materials for one world; dispose it with the world. */
export function dioramaKit(p: DioramaPalette, status: TeamSceneStatusColors) {
  const mats = new Map<string, THREE.Material>()
  const mat = (
    hex: number | string,
    o: { emissive?: number | string; ei?: number; opacity?: number } = {}
  ) => {
    const key = `${hex}|${o.emissive ?? ''}|${o.ei ?? ''}|${o.opacity ?? ''}`
    let m = mats.get(key)
    if (!m) {
      const s = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.88, flatShading: true })
      if (o.emissive !== undefined) {
        s.emissive = new THREE.Color(o.emissive)
        s.emissiveIntensity = o.ei ?? 1
      }
      if (o.opacity !== undefined) {
        s.transparent = true
        s.opacity = o.opacity
        s.depthWrite = false
      }
      m = s
      mats.set(key, m)
    }
    return m
  }
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
  const dispose = (root: THREE.Object3D) => {
    // Why each mesh's own material too: figures and cues make their own, outside this kit's map.
    root.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      for (const one of [m.material ?? []].flat()) {
        one.dispose()
      }
    })
    for (const m of mats.values()) {
      m.dispose()
    }
  }
  return { p, status, mat, mesh, box, dispose }
}
export type DioramaKit = ReturnType<typeof dioramaKit>
