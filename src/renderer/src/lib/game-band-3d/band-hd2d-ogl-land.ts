// The OGL land: sky, sun, fogged ridges, the receding field and the plant row, from one world.
import { Mesh, Plane, Transform, type OGLRenderingContext } from 'ogl'
import { GROUND_TILE, groundCanvasOf, skyCanvasOf, sunCanvasOf } from './hd2d-canvases'
import { DEPTH, LAYER, SAMPLES } from './hd2d-layout'
import { ridgesOf, ridgeVerticesOf, type RidgeArgs } from './hd2d-ridge'
import type { Hd2dWorld } from './hd2d-world'
import type { GpuPool, OglLightUniforms } from './band-hd2d-ogl-kit'
import {
  FLAT_FRAGMENT,
  FLAT_VERTEX,
  RIDGE_FRAGMENT,
  RIDGE_VERTEX,
  SKY_VERTEX
} from './band-hd2d-ogl-shaders'

export type OglLand = { root: Transform; sun: Mesh }

export const buildOglLand = (
  gl: OGLRenderingContext,
  pool: GpuPool,
  light: OglLightUniforms,
  world: Hd2dWorld
): OglLand => {
  const root = new Transform()

  const skyGeometry = pool.geometry({
    position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) }
  })
  const sky = new Mesh(gl, {
    geometry: skyGeometry,
    program: pool.program({
      vertex: SKY_VERTEX,
      fragment: FLAT_FRAGMENT,
      uniforms: { tMap: { value: pool.canvasTexture(skyCanvasOf(world)) } },
      depthWrite: false,
      cullFace: false
    }),
    frustumCulled: false
  })
  sky.setParent(root)

  const ridgeProgram = pool.program({
    vertex: RIDGE_VERTEX,
    fragment: RIDGE_FRAGMENT,
    uniforms: { ...light },
    cullFace: false
  })
  const ridge = (args: RidgeArgs, layer: number): void => {
    const { positions, normals, colors, index } = ridgeVerticesOf(args)
    const mesh = new Mesh(gl, {
      geometry: pool.geometry({
        position: { size: 3, data: positions },
        normal: { size: 3, data: normals },
        color: { size: 3, data: colors },
        index: { data: index }
      }),
      program: ridgeProgram
    })
    mesh.position.z = DEPTH * (1 - layer)
    mesh.setParent(root)
  }
  const ridges = ridgesOf(world)
  ridge(ridges.far, LAYER.far)
  ridge(ridges.mid, LAYER.mid)

  const length = SAMPLES * LAYER.mid
  const field = pool.canvasTexture(groundCanvasOf(world), true)
  const groundGeometry = pool.adopt(new Plane(gl, { width: length, height: DEPTH * 3 }))
  const ground = new Mesh(gl, {
    geometry: groundGeometry,
    program: pool.lit(light, field, [length / GROUND_TILE, (DEPTH * 3) / GROUND_TILE]).program
  })
  ground.rotation.x = -Math.PI / 2
  ground.position.set(length / 2, 0, -DEPTH)
  ground.setParent(root)

  if (world.plants !== null) {
    const { image, lefts } = world.plants
    const k = LAYER.plants
    const z = DEPTH * (1 - k)
    const plants = new Mesh(gl, {
      // Why one merged mesh: it is the single draw three's InstancedMesh makes.
      geometry: pool.quads(
        lefts.map((left) => [(left + image.width / 2) * k, 0, z, image.width * k, image.height * k])
      ),
      program: pool.lit(light, pool.pixelTexture(image)).program
    })
    plants.setParent(root)
  }

  const sun = new Mesh(gl, {
    geometry: pool.quads([[0, -0.5, 0, 1, 1]]),
    program: pool.program({
      vertex: FLAT_VERTEX,
      fragment: FLAT_FRAGMENT,
      uniforms: { tMap: { value: pool.canvasTexture(sunCanvasOf(world)) } },
      transparent: true,
      depthWrite: false,
      cullFace: false
    }),
    frustumCulled: false
  })
  sun.setParent(root)
  return { root, sun }
}
