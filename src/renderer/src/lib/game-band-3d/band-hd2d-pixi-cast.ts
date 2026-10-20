// The pixi cast: each member's pixel sprite, crown, hearts and blob shadow, lit by tint.
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js'
import type {
  SceneDefinition,
  ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import type { BandMember } from './band-scene'
import { heartScaleOf } from './band-stage'
import { billboardTintOf, pixelTextureOf } from './band-hd2d-pixi-land'
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
import { DEPTH, memberPoseOf, screenOf, type Hd2dCamera, type Hd2dView } from './hd2d-layout'
import { lambertOf, linearOf, shadowBlobOf, srgbHexOf, type Hd2dLights } from './hd2d-lighting'
import type { SpriteImage } from './hd2d-world'

type PixiFigure = {
  root: Container
  box: Container
  body: Sprite
  crown: Sprite | null
  hearts: Sprite[]
  blob: Sprite
  width: number
  height: number
}

/** The OGL blob's smoothstep falloff, as canvas gradient stops. */
const blobCanvasOf = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')
  if (g !== null) {
    const fill = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const k = Math.min(1, Math.max(0, (r - 0.35) / 0.65))
      fill.addColorStop(Math.min(1, r), `rgba(0,0,0,${(1 - k * k * (3 - 2 * k)) * 0.35})`)
    }
    g.fillStyle = fill
    g.fillRect(0, 0, 64, 64)
  }
  return canvas
}

/** Where the cast draws: blobs under the figures, then every lit heart, then every empty one. */
export type PixiCastLayers = {
  blobs: Container
  figures: Container
  heartsOn: Container
  heartsOff: Container
}

export const createPixiCast = (scene: SceneDefinition, layers: PixiCastLayers) => {
  const textures: Texture[] = []
  const keep = (texture: Texture): Texture => {
    textures.push(texture)
    return texture
  }
  const poses = createPoseImages(scene, (image) => keep(pixelTextureOf(image)))
  const heartOn = keep(pixelTextureOf(heartImageOf(HEART_ON)))
  const heartOff = keep(pixelTextureOf(heartImageOf(HEART_OFF)))
  const blobTexture = keep(
    new Texture({ source: new CanvasSource({ resource: blobCanvasOf(), scaleMode: 'linear' }) })
  )
  // Why baked: three's hurt flash adds light after lighting, which a multiplying tint cannot do.
  let flashes = new Map<Texture, Texture>()
  let benchedFlashes = new Map<Texture, Texture>()
  let flashLights: Hd2dLights | null = null
  const flashOf = (image: SpriteImage, texture: Texture, lights: Hd2dLights, benched: boolean) => {
    if (flashLights !== lights) {
      for (const one of [...flashes.values(), ...benchedFlashes.values()]) {
        one.destroy(true)
      }
      flashes = new Map()
      benchedFlashes = new Map()
      flashLights = lights
    }
    const bucket = benched ? benchedFlashes : flashes
    const kept = bucket.get(texture)
    if (kept !== undefined) {
      return kept
    }
    const lit = lambertOf(linearOf(benched ? BENCHED_TINT : 0xffffff), [0, 0, 1], lights)
    const glow = linearOf(HURT_GLOW)
    const rgba = new Uint8ClampedArray(image.rgba)
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = linearOf(
        ((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0)
      )
      const hex = srgbHexOf([r * lit[0] + glow[0], g * lit[1] + glow[1], b * lit[2] + glow[2]])
      rgba.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], i)
    }
    const one = pixelTextureOf({ width: image.width, height: image.height, rgba })
    bucket.set(texture, one)
    return one
  }
  const made = new Map<string, PixiFigure>()
  let tints = new Map<string, number>()
  let tintLights: Hd2dLights | null = null
  const tintOf = (lights: Hd2dLights, multiply: number, add: number): number => {
    if (tintLights !== lights) {
      tints = new Map()
      tintLights = lights
    }
    const key = `${multiply}:${add}`
    const kept = tints.get(key)
    if (kept !== undefined) {
      return kept
    }
    const tint = billboardTintOf(lights, multiply, add)
    tints.set(key, tint)
    return tint
  }

  const figureOf = (member: BandMember, phase: ScenePhase): PixiFigure => {
    const kept = made.get(member.key)
    if (kept !== undefined) {
      return kept
    }
    const first = poses.poseOf(phase, 0, false, FIRST_RING)
    const { width, height } = first.image
    const root = new Container()
    const box = new Container()
    const body = new Sprite(first.texture)
    body.anchor.set(0.5, 1)
    box.addChild(body)
    let crownSprite: Sprite | null = null
    if (member.isLead) {
      const crown = crownOf(scene, phase, first.image)
      crownSprite = new Sprite(keep(pixelTextureOf(crown.image)))
      crownSprite.anchor.set(0.5, 1)
      crownSprite.position.set(crown.x, -crown.y)
      box.addChild(crownSprite)
    }
    root.addChild(box)
    const hearts = Array.from({ length: MAX_HEARTS }, () => {
      const heart = new Sprite(heartOn)
      heart.anchor.set(0.5)
      layers.heartsOn.addChild(heart)
      return heart
    })
    const blob = new Sprite(blobTexture)
    blob.anchor.set(0.5)
    layers.blobs.addChild(blob)
    layers.figures.addChild(root)
    const figure = { root, box, body, crown: crownSprite, hearts, blob, width, height }
    made.set(member.key, figure)
    return figure
  }

  /** One frame of a member at `at`: walk, hop, sit or lie benched; hearts pop and shrink. */
  const pose = (args: {
    member: BandMember
    phase: ScenePhase
    t: number
    seed: number
    at: number
    camera: Hd2dCamera
    view: Hd2dView
    shadows: boolean
    lights: Hd2dLights
  }): PixiFigure => {
    const { member, t, camera, view, lights } = args
    const figure = figureOf(member, args.phase)
    const frame = memberPoseOf(member, t, args.seed)
    const shown = poses.poseOf(args.phase, frame.step, frame.isSitting, ringOf(member))
    const isFlashing = isHurtFlashOn(member, t)
    figure.body.texture = isFlashing
      ? flashOf(shown.image, shown.texture, lights, member.benched)
      : shown.texture
    // Why fixed size: three stretches every pose onto the first pose's quad.
    figure.body.width = figure.width
    figure.body.height = figure.height
    figure.body.tint = isFlashing
      ? 0xffffff
      : tintOf(lights, member.benched ? BENCHED_TINT : 0xffffff, 0)
    if (figure.crown !== null) {
      figure.crown.tint = tintOf(lights, 0xffffff, 0)
    }
    const feet = screenOf(camera, view, args.at, 0)
    const unit = view.cssHeight / view.pixels
    figure.root.position.set(feet.x, feet.y)
    figure.root.scale.set(unit)
    figure.box.position.set(0, -frame.lift)
    // Why negative: pixi's y grows down, so three's counter-clockwise lie is a negative turn.
    figure.box.rotation = frame.isBenched ? -Math.PI / 2 : 0
    figure.hearts.forEach((heart, slot) => {
      const isOn = slot < member.lives
      const scale = heartScaleOf(member, slot)
      // Why separate layers: three draws all lit hearts, then all empty ones, so empties win ties.
      const layer = isOn ? layers.heartsOn : layers.heartsOff
      if (heart.parent !== layer) {
        layer.addChild(heart)
      }
      heart.texture = isOn ? heartOn : heartOff
      const at = heartAtOf(slot, figure.height)
      heart.position.set(feet.x + at.x * unit, feet.y - at.y * unit)
      heart.width = HEART_SIZE.width * scale * unit
      heart.height = HEART_SIZE.height * scale * unit
      heart.tint = tintOf(lights, 0xffffff, isOn ? HEART_GLOW : 0)
    })
    figure.blob.visible = args.shadows
    if (args.shadows) {
      const blob = shadowBlobOf(args.at, figure.height, figure.width, lights.sunDirection)
      const front = screenOf(camera, view, blob.x, 0, DEPTH - (blob.z + blob.length / 2))
      const back = screenOf(camera, view, blob.x, 0, DEPTH - (blob.z - blob.length / 2))
      figure.blob.position.set(front.x, (front.y + back.y) / 2)
      figure.blob.width = blob.width * unit * (DEPTH / (DEPTH - blob.z))
      figure.blob.height = Math.max(1, front.y - back.y)
    }
    return figure
  }

  const dispose = (): void => {
    for (const texture of [...textures, ...flashes.values(), ...benchedFlashes.values()]) {
      texture.destroy(true)
    }
  }

  return { pose, dispose }
}
