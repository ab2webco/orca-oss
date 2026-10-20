// The pixi land: 2D parallax stand-ins for three's depth layers, lit and fogged from the same world.
import {
  BufferImageSource,
  CanvasSource,
  Container,
  Geometry,
  Mesh,
  type ScaleMode,
  Shader,
  Sprite,
  Texture,
  UniformGroup
} from 'pixi.js'
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import { GROUND_SOIL_MIX, skyCanvasOf, sunCanvasOf } from './hd2d-canvases'
import { SRGB_GLSL } from './hd2d-glsl'
import { DEPTH, fogAt, LAYER } from './hd2d-layout'
import { lambertOf, linearOf, srgbHexOf, type Hd2dLights } from './hd2d-lighting'
import { ridgesOf, ridgeVerticesOf, type RidgeArgs } from './hd2d-ridge'
import type { Hd2dWorld, SpriteImage } from './hd2d-world'

const VERTEX = /* glsl */ `
in vec2 aPosition;
in vec3 aColor;
in float aFog;
out vec3 vColor;
out float vFog;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vColor = aColor;
  vFog = aFog;
}`

/** Colours arrive lit in linear space; fog mixes there too, as three does. */
const FRAGMENT = /* glsl */ `
${SRGB_GLSL}
in vec3 vColor;
in float vFog;
uniform vec3 uFogColor;
out vec4 finalColor;
void main() {
  finalColor = vec4(toSrgb(mix(vColor, uFogColor, vFog)), 1.0);
}`

/** One shader for every land mesh, so the CI-failure fog tint is one uniform write. */
export const createLandShader = (): { shader: Shader; fog: UniformGroup } => {
  const fog = new UniformGroup({ uFogColor: { value: new Float32Array(3), type: 'vec3<f32>' } })
  return {
    shader: Shader.from({ gl: { vertex: VERTEX, fragment: FRAGMENT }, resources: { fog } }),
    fog
  }
}

export const pixelTextureOf = (image: SpriteImage, scaleMode: ScaleMode = 'nearest'): Texture =>
  new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length),
      width: image.width,
      height: image.height,
      scaleMode
    })
  })

const canvasTextureOf = (canvas: HTMLCanvasElement): Texture =>
  new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear' }) })

/** A billboard's lit colour as a sprite tint: Lambert on a face toward the camera. */
export const billboardTintOf = (lights: Hd2dLights, multiply = 0xffffff, add = 0): number => {
  const lit = lambertOf(linearOf(multiply), [0, 0, 1], lights)
  const glow = linearOf(add)
  return srgbHexOf([lit[0] + glow[0], lit[1] + glow[1], lit[2] + glow[2]])
}

const ridgeMeshOf = (args: RidgeArgs, layer: number, lights: Hd2dLights, shader: Shader): Mesh => {
  const { positions, normals, colors, index } = ridgeVerticesOf(args)
  const count = positions.length / 3
  const xy = new Float32Array(count * 2)
  const lit = new Float32Array(count * 3)
  const fog = new Float32Array(count).fill(fogAt(DEPTH * layer))
  for (let v = 0; v < count; v += 1) {
    // y flipped: pixi's y grows down.
    xy.set([positions[v * 3] ?? 0, -(positions[v * 3 + 1] ?? 0)], v * 2)
    const normal = [normals[v * 3] ?? 0, normals[v * 3 + 1] ?? 1, normals[v * 3 + 2] ?? 0] as const
    const color = [colors[v * 3] ?? 0, colors[v * 3 + 1] ?? 0, colors[v * 3 + 2] ?? 0] as const
    lit.set(lambertOf(color, normal, lights), v * 3)
  }
  const geometry = new Geometry({
    attributes: { aPosition: xy, aColor: lit, aFog: fog },
    indexBuffer: index
  })
  return new Mesh({ geometry, shader })
}

const GROUND_ROWS = 12

/**
 * A strip of the flat field between two distances, one unit wide and in hd pixels below the view
 * centre; the scene scales it to the band. Value noise is left out: it is one averaged colour.
 */
const groundStripOf = (
  world: Hd2dWorld,
  lights: Hd2dLights,
  shader: Shader,
  near: number,
  far: number
): Mesh => {
  const cameraY = world.ground - world.pixels / 2
  const field = lambertOf(
    linearOf(mix(world.grass, world.soil, GROUND_SOIL_MIX)),
    [0, 1, 0],
    lights
  )
  const xy = new Float32Array((GROUND_ROWS + 1) * 4)
  const lit = new Float32Array((GROUND_ROWS + 1) * 6)
  const fog = new Float32Array((GROUND_ROWS + 1) * 2)
  const index = new Uint32Array(GROUND_ROWS * 6)
  for (let r = 0; r <= GROUND_ROWS; r += 1) {
    // Rows evenly spaced on screen, which is evenly spaced in 1 / distance.
    const inverse = 1 / near + ((1 / far - 1 / near) * r) / GROUND_ROWS
    const distance = 1 / inverse
    const y = cameraY * DEPTH * inverse
    xy.set([0, y, 1, y], r * 4)
    lit.set([...field, ...field], r * 6)
    fog.set([fogAt(distance), fogAt(distance)], r * 2)
    if (r < GROUND_ROWS) {
      const a = r * 2
      index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], r * 6)
    }
  }
  const geometry = new Geometry({
    attributes: { aPosition: xy, aColor: lit, aFog: fog },
    indexBuffer: index
  })
  return new Mesh({ geometry, shader })
}

export type PixiLand = {
  sky: Sprite
  sun: Sprite
  /** Each moves with its own parallax factor; `null` is screen-fixed ground. */
  layers: { node: Container; factor: number | null }[]
  /** Screen-fixed ground nearer than the characters, drawn over them. */
  foreground: Mesh
  textures: Texture[]
  geometries: Geometry[]
}

export const buildPixiLand = (world: Hd2dWorld, lights: Hd2dLights, shader: Shader): PixiLand => {
  const textures: Texture[] = []
  const keep = (texture: Texture): Texture => {
    textures.push(texture)
    return texture
  }
  const sky = new Sprite(keep(canvasTextureOf(skyCanvasOf(world))))
  const sun = new Sprite(keep(canvasTextureOf(sunCanvasOf(world))))
  sun.anchor.set(0.5)
  const ridges = ridgesOf(world)
  const far = ridgeMeshOf(ridges.far, LAYER.far, lights, shader)
  const mid = ridgeMeshOf(ridges.mid, LAYER.mid, lights, shader)
  // Why three strips: each ridge's foot is hidden by the ground in front of it, not behind it.
  const back = groundStripOf(world, lights, shader, DEPTH * LAYER.far, DEPTH * 3.5)
  const middle = groundStripOf(world, lights, shader, DEPTH * LAYER.mid, DEPTH * LAYER.far)
  const front = groundStripOf(world, lights, shader, DEPTH, DEPTH * LAYER.mid)
  // Why drawn over the cast: the ground before the characters hides a benched one's lower half.
  const foreground = groundStripOf(world, lights, shader, DEPTH * 0.5, DEPTH)
  const plants = new Container()
  if (world.plants !== null) {
    const { image, lefts } = world.plants
    const texture = keep(pixelTextureOf(image))
    const tint = billboardTintOf(lights)
    for (const left of lefts) {
      const plant = new Sprite(texture)
      plant.anchor.set(0.5, 1)
      plant.position.set((left + image.width / 2) * LAYER.plants, 0)
      plant.scale.set(LAYER.plants)
      plant.tint = tint
      plants.addChild(plant)
    }
  }
  return {
    sky,
    sun,
    layers: [
      { node: back, factor: null },
      { node: far, factor: LAYER.far },
      { node: middle, factor: null },
      { node: mid, factor: LAYER.mid },
      { node: front, factor: null },
      { node: plants, factor: LAYER.plants }
    ],
    foreground,
    textures,
    geometries: [far, mid, back, middle, front, foreground].map((mesh) => mesh.geometry)
  }
}
