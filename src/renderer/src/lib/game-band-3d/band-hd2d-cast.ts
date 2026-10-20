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
import {
  crownAtOf,
  crownPixel,
  CROWN_WIDTH,
  STATE_RING
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-party'
import type { MemberState } from '../../../../../resources/claude-plugins/orca-game/hooks/party-sprites'
import { costumeSpriteOf } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-sprite'
import type {
  SceneDefinition,
  ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import type { BandMember } from './band-scene'
import { heartScaleOf } from './band-stage'
import { spriteImageOf, type SpriteImage } from './hd2d-world'

const MAX_HEARTS = 5
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'] as const
const HEART_ON = 0xff4d6d
const HEART_OFF = 0x4a4a5c

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

const heartImage = (color: number): SpriteImage => {
  const rgba = new Uint8ClampedArray(7 * 6 * 4)
  HEART.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === '#') {
        rgba.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255], (y * 7 + x) * 4)
      }
    })
  )
  return { width: 7, height: 6, rgba }
}

const ringStateOf = (member: BandMember): MemberState =>
  member.state === 'waiting' ? 'waiting' : member.state === 'working' ? 'working' : 'idle'

export type Figure = {
  root: Group
  body: Mesh
  hearts: Mesh[]
  height: number
}

/** Builds and poses each member's billboard, crown and hearts; textures are shared per pose. */
export const createCast = (scene: SceneDefinition) => {
  const textures = new Map<string, { image: SpriteImage; texture: Texture }>()
  const poseTexture = (phase: ScenePhase, frame: number, isSitting: boolean, ring: number) => {
    const key = `${phase}:${isSitting ? 's' : frame % 2}:${ring}`
    const kept = textures.get(key)
    if (kept !== undefined) {
      return kept
    }
    const image = spriteImageOf(costumeSpriteOf(scene.costumes[phase], frame, isSitting), ring)
    const made = { image, texture: pixelTextureOf(image) }
    textures.set(key, made)
    return made
  }
  const heartOn = pixelTextureOf(heartImage(HEART_ON))
  const heartOff = pixelTextureOf(heartImage(HEART_OFF))
  const heartGeometry = new PlaneGeometry(2.1, 1.8)
  const heartMaterials = {
    on: new MeshLambertMaterial({ map: heartOn, alphaTest: 0.5, emissive: 0x331018 }),
    off: new MeshLambertMaterial({ map: heartOff, alphaTest: 0.5 })
  }
  const crownImage = (
    rows: readonly string[]
  ): { image: SpriteImage; at: { left: number; top: number } } => {
    const at = crownAtOf(rows, 0, 0)
    const rgba = new Uint8ClampedArray(CROWN_WIDTH * 2 * 4)
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < CROWN_WIDTH; x += 1) {
        const color = crownPixel(x, y, 0, 0)
        if (color !== undefined) {
          rgba.set(
            [(color >> 16) & 255, (color >> 8) & 255, color & 255, 255],
            (y * CROWN_WIDTH + x) * 4
          )
        }
      }
    }
    return { image: { width: CROWN_WIDTH, height: 2, rgba }, at }
  }
  const figures = new Map<string, Figure>()

  const figureOf = (member: BandMember, phase: ScenePhase): Figure => {
    const kept = figures.get(member.key)
    if (kept !== undefined) {
      return kept
    }
    const first = poseTexture(phase, 0, false, STATE_RING.working)
    const body = billboardOf(first.image, first.texture)
    const root = new Group()
    root.add(body)
    if (member.isLead) {
      const sprite = costumeSpriteOf(scene.costumes[phase], 0, false)
      const crown = crownImage(sprite.rows)
      const mesh = billboardOf(crown.image, pixelTextureOf(crown.image))
      mesh.position.set(
        crown.at.left + CROWN_WIDTH / 2 - first.image.width / 2,
        first.image.height - crown.at.top - 2,
        0.01
      )
      body.add(mesh)
    }
    const hearts = Array.from({ length: MAX_HEARTS }, (_, slot) => {
      const heart = new Mesh(heartGeometry, heartMaterials.on)
      heart.position.set((slot - (MAX_HEARTS - 1) / 2) * 2.3, first.image.height + 2.5, 0.02)
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
    const isSitting = member.state === 'idle' || member.state === 'done' || member.benched
    const step = Math.floor(t / 220 + seed)
    const ring = STATE_RING[ringStateOf(member)]
    const { texture } = poseTexture(phase, step, isSitting, ring)
    const material = figure.body.material as MeshLambertMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    material.emissive.setHex(member.hurt && Math.sin(t / 90) > 0 ? 0x3a0c0c : 0x000000)
    material.color.setHex(member.benched ? 0x8a8a8a : 0xffffff)
    const bob = member.state === 'working' ? step % 2 : 0
    const hop = member.state === 'waiting' ? Math.abs(Math.sin(t / 260 + seed)) * 3 : 0
    figure.body.position.y = bob + hop
    figure.body.rotation.z = member.benched ? Math.PI / 2 : 0
    figure.hearts.forEach((heart, slot) => {
      heart.material = slot < member.lives ? heartMaterials.on : heartMaterials.off
      heart.scale.setScalar(heartScaleOf(member, slot))
    })
    return figure
  }

  const dispose = (): void => {
    for (const one of textures.values()) {
      one.texture.dispose()
    }
    heartOn.dispose()
    heartOff.dispose()
    heartGeometry.dispose()
  }

  return { pose, figures, dispose }
}
