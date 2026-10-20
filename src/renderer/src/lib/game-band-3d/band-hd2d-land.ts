// The smooth half of HD-2D: the scene's own silhouettes as lit, fogged meshes at real depths.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture
} from 'three'
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import type { Hd2dWorld } from './hd2d-world'

/** Camera distance to the characters' plane, in hd pixels. */
export const DEPTH = 80
/** Each layer's distance as a multiple of DEPTH; its art is scaled by the same factor. */
export const LAYER = { far: 2.6, mid: 1.6, plants: 1.15 } as const

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

export const skyTextureOf = (world: Hd2dWorld): Texture => {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = world.sky.length
  const g = canvas.getContext('2d')
  world.sky.forEach((color, y) => {
    if (g !== null) {
      g.fillStyle = css(color)
      g.fillRect(0, y, 2, 1)
    }
  })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  return texture
}

const softDiscTexture = (inner: string, outer: string): Texture => {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g !== null) {
    const fill = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    fill.addColorStop(0, inner)
    fill.addColorStop(0.28, inner)
    fill.addColorStop(0.36, outer)
    fill.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = fill
    g.fillRect(0, 0, 128, 128)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** The sun or moon with a soft halo, for the camera to carry: it never scrolls. */
export const sunSpriteOf = (world: Hd2dWorld): Sprite => {
  const disc = world.night > 0.5 ? 0xe8ecff : mix(world.sun.color, 0xffffff, 0.3)
  const halo = `rgba(${(disc >> 16) & 255},${(disc >> 8) & 255},${disc & 255},0.35)`
  const material = new SpriteMaterial({
    map: softDiscTexture(css(disc), halo),
    fog: false,
    depthWrite: false
  })
  return new Sprite(material)
}

const linear = new Color()
const put = (colors: Float32Array, i: number, hex: number): void => {
  linear.setHex(hex)
  colors.set([linear.r, linear.g, linear.b], i * 3)
}

/**
 * A ridge from one height per column: a top row on the silhouette, a lower row and a base, so the
 * colour falls off smoothly and each flank's normal leans toward or away from the sun.
 */
export const ridgeOf = (args: {
  heights: Float32Array
  scale: number
  top: number
  base: number
  /** Heights above this get the cap colour. */
  capAbove?: number
  cap?: number
}): Mesh => {
  const { heights, scale } = args
  const n = heights.length
  const rows = 3
  const positions = new Float32Array(n * rows * 3)
  const normals = new Float32Array(n * rows * 3)
  const colors = new Float32Array(n * rows * 3)
  for (let x = 0; x < n; x += 1) {
    const h = heights[x] ?? 0
    const slope = ((heights[x + 1] ?? h) - (heights[x - 1] ?? h)) / 2
    const lean = Math.hypot(slope, 1, 0.9)
    const capped = args.capAbove !== undefined && args.cap !== undefined && h > args.capAbove
    const ys = [h, h * 0.55, -2]
    ys.forEach((y, r) => {
      const v = x * rows + r
      positions.set([x * scale, y * scale, 0], v * 3)
      normals.set([-slope / lean, 1 / lean, 0.9 / lean], v * 3)
      const shade =
        r === 0
          ? capped
            ? (args.cap ?? args.top)
            : args.top
          : r === 1
            ? mix(args.top, args.base, 0.5)
            : args.base
      put(colors, v, shade)
    })
  }
  const index: number[] = []
  for (let x = 0; x < n - 1; x += 1) {
    for (let r = 0; r < rows - 1; r += 1) {
      const a = x * rows + r
      const b = (x + 1) * rows + r
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(index)
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }))
}

/** Ground that recedes to the hills: grass by the characters, value noise so it reads as a field. */
export const groundOf = (world: Hd2dWorld, length: number): Mesh => {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g !== null) {
    for (let y = 0; y < 128; y += 4) {
      for (let x = 0; x < 128; x += 4) {
        const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
        g.fillStyle = css(mix(world.grass, world.soil, Math.abs(n) * 0.45))
        g.fillRect(x, y, 4, 4)
      }
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(length / 24, (DEPTH * 3) / 24)
  texture.anisotropy = 4
  const ground = new Mesh(
    new PlaneGeometry(length, DEPTH * 3),
    new MeshLambertMaterial({ map: texture })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(length / 2, 0, -DEPTH)
  ground.receiveShadow = true
  return ground
}
