// The smooth half of HD-2D: the scene's own silhouettes as lit, fogged meshes at real depths.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
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
import { groundCanvasOf, GROUND_TILE, skyCanvasOf, sunCanvasOf } from './hd2d-canvases'
import { DEPTH } from './hd2d-layout'
import { ridgeVerticesOf, type RidgeArgs } from './hd2d-ridge'
import type { Hd2dWorld } from './hd2d-world'

export const skyTextureOf = (world: Hd2dWorld): Texture => {
  const texture = new CanvasTexture(skyCanvasOf(world))
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  return texture
}

/** The sun or moon with a soft halo, for the camera to carry: it never scrolls. */
export const sunSpriteOf = (world: Hd2dWorld): Sprite => {
  const map = new CanvasTexture(sunCanvasOf(world))
  map.colorSpace = SRGBColorSpace
  return new Sprite(new SpriteMaterial({ map, fog: false, depthWrite: false }))
}

export const ridgeOf = (args: RidgeArgs): Mesh => {
  const { positions, normals, colors, index } = ridgeVerticesOf(args)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }))
}

/** Ground that recedes to the hills: grass by the characters, value noise so it reads as a field. */
export const groundOf = (world: Hd2dWorld, length: number): Mesh => {
  const texture = new CanvasTexture(groundCanvasOf(world))
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(length / GROUND_TILE, (DEPTH * 3) / GROUND_TILE)
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
