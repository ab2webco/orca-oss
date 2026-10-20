// The OGL cast: each member's pixel billboard, crown, hearts and a soft blob shadow.
import { Mesh, type OGLRenderingContext, type Program, type Texture, Transform } from 'ogl'
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
import { linearOf, shadowBlobOf, type Rgb } from './hd2d-lighting'
import type { GpuPool, LitLook, OglLightUniforms } from './band-hd2d-ogl-kit'
import { BLOB_FRAGMENT, FLAT_VERTEX } from './band-hd2d-ogl-shaders'

type OglFigure = {
  root: Transform
  body: Mesh
  /** Body and crown, drawn in member order after every heart, as three's material ids order them. */
  parts: Mesh[]
  look: LitLook
  hearts: Mesh[]
  blob: Mesh
  width: number
  height: number
}

const HURT = [...linearOf(HURT_GLOW)]
const BENCHED = [...linearOf(BENCHED_TINT)]

export const createOglCast = (
  gl: OGLRenderingContext,
  pool: GpuPool,
  light: OglLightUniforms,
  scene: SceneDefinition
) => {
  const poses = createPoseImages(scene, pool.pixelTexture)
  const heartGeometry = pool.quads([
    [0, -HEART_SIZE.height / 2, 0, HEART_SIZE.width, HEART_SIZE.height]
  ])
  const heartOn = pool.lit(light, pool.pixelTexture(heartImageOf(HEART_ON)))
  heartOn.look.uEmissive.value = [...linearOf(HEART_GLOW)]
  const heartOff = pool.lit(light, pool.pixelTexture(heartImageOf(HEART_OFF)))
  const blobGeometry = pool.quads([[0, -0.5, 0, 1, 1]])
  const blobProgram: Program = pool.program({
    vertex: FLAT_VERTEX,
    fragment: BLOB_FRAGMENT,
    uniforms: { uOpacity: { value: 0.35 } },
    transparent: true,
    depthWrite: false,
    cullFace: false
  })
  const figures = new Map<string, OglFigure>()

  const figureOf = (member: BandMember, phase: ScenePhase, parent: Transform): OglFigure => {
    const kept = figures.get(member.key)
    if (kept !== undefined) {
      return kept
    }
    const first = poses.poseOf(phase, 0, false, FIRST_RING)
    const { width, height } = first.image
    const root = new Transform()
    const lit = pool.lit(light, first.texture)
    const body = new Mesh(gl, {
      geometry: pool.quads([[0, 0, 0, width, height]]),
      program: lit.program
    })
    body.setParent(root)
    const parts = [body]
    if (member.isLead) {
      const crown = crownOf(scene, phase, first.image)
      const mesh = new Mesh(gl, {
        geometry: pool.quads([[0, 0, 0, crown.image.width, crown.image.height]]),
        program: pool.lit(light, pool.pixelTexture(crown.image)).program
      })
      mesh.position.set(crown.x, crown.y, 0.01)
      mesh.setParent(body)
      parts.push(mesh)
    }
    const hearts = Array.from({ length: MAX_HEARTS }, (_, slot) => {
      const heart = new Mesh(gl, { geometry: heartGeometry, program: heartOn.program })
      const at = heartAtOf(slot, height)
      heart.position.set(at.x, at.y, 0.02)
      heart.setParent(root)
      return heart
    })
    const blob = new Mesh(gl, { geometry: blobGeometry, program: blobProgram })
    blob.rotation.x = -Math.PI / 2
    blob.setParent(parent)
    root.setParent(parent)
    const made = { root, body, parts, look: lit.look, hearts, blob, width, height }
    figures.set(member.key, made)
    return made
  }

  /** One frame of a member at `at`: walk, hop, sit or lie benched; hearts pop and shrink. */
  const pose = (args: {
    member: BandMember
    phase: ScenePhase
    t: number
    seed: number
    at: number
    parent: Transform
    shadows: boolean
    sunDirection: Rgb
  }): OglFigure => {
    const { member, t } = args
    const figure = figureOf(member, args.phase, args.parent)
    const frame = memberPoseOf(member, t, args.seed)
    const texture: Texture = poses.poseOf(
      args.phase,
      frame.step,
      frame.isSitting,
      ringOf(member)
    ).texture
    figure.look.tMap.value = texture
    figure.look.uEmissive.value = isHurtFlashOn(member, t) ? HURT : [0, 0, 0]
    figure.look.uTint.value = member.benched ? BENCHED : [1, 1, 1]
    figure.root.position.set(args.at, 0, 0)
    for (const part of figure.parts) {
      part.renderOrder = 3 + args.seed
    }
    figure.body.position.y = frame.lift
    figure.body.rotation.z = frame.isBenched ? Math.PI / 2 : 0
    figure.hearts.forEach((heart, slot) => {
      heart.program = slot < member.lives ? heartOn.program : heartOff.program
      heart.renderOrder = slot < member.lives ? 1 : 2
      heart.scale.set(heartScaleOf(member, slot))
    })
    figure.blob.visible = args.shadows
    const blob = shadowBlobOf(args.at, figure.height, figure.width, args.sunDirection)
    figure.blob.position.set(blob.x, 0.05, blob.z)
    figure.blob.scale.set(blob.width, blob.length, 1)
    return figure
  }

  return { pose }
}
