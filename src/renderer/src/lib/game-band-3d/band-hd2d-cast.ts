// The crisp half of HD-2D: the scene's own costumes as lit, shadow-casting pixel billboards.
import {
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Texture
} from 'three'
import type {
  SceneDefinition,
  ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import type { BandMember } from './band-scene'
import { heartScaleOf } from './band-stage'
import {
  BENCHED_TINT,
  createPoseImages,
  crownOf,
  FIRST_RING,
  heartAtOf,
  heartImageOf,
  HEART_GLOW,
  HEART_OFF,
  HEART_ON,
  HEART_SIZE,
  HURT_GLOW,
  isHurtFlashOn,
  MAX_HEARTS,
  ringOf
} from './hd2d-cast-images'
import { memberPoseOf } from './hd2d-layout'
import type { SpriteImage } from './hd2d-world'

/** Pixel art stays pixel art: nearest sampling, rows flipped for WebGL's bottom-up texture. */
export const pixelTextureOf = (image: SpriteImage): Texture => {
  const flipped = new Uint8Array(image.rgba.length)
  const stride = image.width * 4
  for (let y = 0; y < image.height; y += 1) {
    flipped.set(image.rgba.subarray(y * stride, (y + 1) * stride), (image.height - 1 - y) * stride)
  }
  const texture = new DataTexture(flipped, image.width, image.height, RGBAFormat)
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export const billboardOf = (image: SpriteImage, texture: Texture): Mesh => {
  const geometry = new PlaneGeometry(image.width, image.height)
  geometry.translate(0, image.height / 2, 0)
  const mesh = new Mesh(
    geometry,
    new MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: DoubleSide })
  )
  mesh.castShadow = true
  return mesh
}

export type Figure = {
  root: Group
  body: Mesh
  hearts: Mesh[]
  height: number
}

/** Builds and poses each member's billboard, crown and hearts; textures are shared per pose. */
export const createCast = (scene: SceneDefinition) => {
  const poses = createPoseImages(scene, pixelTextureOf)
  const heartOn = pixelTextureOf(heartImageOf(HEART_ON))
  const heartOff = pixelTextureOf(heartImageOf(HEART_OFF))
  const heartGeometry = new PlaneGeometry(HEART_SIZE.width, HEART_SIZE.height)
  const heartMaterials = {
    on: new MeshLambertMaterial({ map: heartOn, alphaTest: 0.5, emissive: HEART_GLOW }),
    off: new MeshLambertMaterial({ map: heartOff, alphaTest: 0.5 })
  }
  const figures = new Map<string, Figure>()

  const figureOf = (member: BandMember, phase: ScenePhase): Figure => {
    const kept = figures.get(member.key)
    if (kept !== undefined) {
      return kept
    }
    const first = poses.poseOf(phase, 0, false, FIRST_RING)
    const body = billboardOf(first.image, first.texture)
    const root = new Group()
    root.add(body)
    if (member.isLead) {
      const crown = crownOf(scene, phase, first.image)
      const mesh = billboardOf(crown.image, pixelTextureOf(crown.image))
      mesh.position.set(crown.x, crown.y, 0.01)
      body.add(mesh)
    }
    const hearts = Array.from({ length: MAX_HEARTS }, (_, slot) => {
      const heart = new Mesh(heartGeometry, heartMaterials.on)
      const at = heartAtOf(slot, first.image.height)
      heart.position.set(at.x, at.y, 0.02)
      root.add(heart)
      return heart
    })
    const made = { root, body, hearts, height: first.image.height }
    figures.set(member.key, made)
    return made
  }

  /** One frame of a member: walk, hop, sit or lie benched; hearts pop and shrink with lives. */
  const pose = (member: BandMember, phase: ScenePhase, t: number, seed: number): Figure => {
    const figure = figureOf(member, phase)
    const frame = memberPoseOf(member, t, seed)
    const { texture } = poses.poseOf(phase, frame.step, frame.isSitting, ringOf(member))
    const material = figure.body.material as MeshLambertMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    material.emissive.setHex(isHurtFlashOn(member, t) ? HURT_GLOW : 0x000000)
    material.color.setHex(member.benched ? BENCHED_TINT : 0xffffff)
    figure.body.position.y = frame.lift
    figure.body.rotation.z = frame.isBenched ? Math.PI / 2 : 0
    figure.hearts.forEach((heart, slot) => {
      heart.material = slot < member.lives ? heartMaterials.on : heartMaterials.off
      heart.scale.setScalar(heartScaleOf(member, slot))
    })
    return figure
  }

  const dispose = (): void => {
    for (const one of poses.all()) {
      one.texture.dispose()
    }
    heartOn.dispose()
    heartOff.dispose()
    heartGeometry.dispose()
  }

  return { pose, figures, dispose }
}
