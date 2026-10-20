// Library-free HD-2D staging shared by the three, ogl and pixi bands, so all three move identically.
import type { BandMember, BandModel, MemberRect } from './band-scene'

/** Camera distance to the characters' plane, in hd pixels. */
export const DEPTH = 80
/** Each layer's distance as a multiple of DEPTH; its art is scaled by the same factor. */
export const LAYER = { far: 2.6, mid: 1.6, plants: 1.15 } as const
/** Silhouette samples per layer; at the walk speed the camera loops about every ten minutes. */
export const SAMPLES = 1600
export const WALK_PER_S = 3.5
export const SUN_DISTANCE = 600
export const FOG = { near: DEPTH * 1.25, far: DEPTH * 5.2 } as const

/** Where the camera looks at the characters' plane; `width` is that plane's visible width. */
export type Hd2dCamera = { x: number; y: number; width: number }
export type Hd2dView = { cssWidth: number; cssHeight: number; pixels: number }

export const cameraAt = (
  t: number,
  frame: { pixels: number; ground: number; aspect: number }
): Hd2dCamera => {
  const width = frame.pixels * frame.aspect
  const start = (width * LAYER.far) / 2
  const span = SAMPLES * LAYER.mid - start - width * LAYER.mid
  return {
    x: start + (((t / 1000) * WALK_PER_S) % Math.max(1, span)),
    y: frame.ground - frame.pixels / 2,
    width
  }
}

/** CSS pixels of a world point `distance` away from a camera that looks straight down -z. */
export const screenOf = (
  camera: { x: number; y: number },
  view: Hd2dView,
  x: number,
  y: number,
  distance: number = DEPTH
): { x: number; y: number } => {
  const unit = (view.cssHeight / view.pixels) * (DEPTH / distance)
  return {
    x: view.cssWidth / 2 + (x - camera.x) * unit,
    y: view.cssHeight / 2 - (y - camera.y) * unit
  }
}

export const memberXsOf = (
  members: readonly { isLead: boolean }[],
  camera: Hd2dCamera
): number[] => {
  const pitch = Math.min(13, (camera.width * 0.8) / Math.max(1, members.length))
  const lead = camera.x + camera.width * 0.08
  let behind = 0
  return members.map((member) => {
    if (member.isLead) {
      return lead
    }
    behind += 1
    return lead - behind * pitch
  })
}

export const memberRectOf = (
  key: string,
  at: number,
  height: number,
  camera: { x: number; y: number },
  view: Hd2dView
): MemberRect => {
  const top = screenOf(camera, view, at - 6, height + 2)
  const bottom = screenOf(camera, view, at + 6, 0)
  return { key, x: top.x, y: top.y, width: bottom.x - top.x, height: bottom.y - top.y }
}

export type Hd2dPose = { step: number; isSitting: boolean; isBenched: boolean; lift: number }

/** One frame of a member: the walk step, whether it sits, and how high it bobs or hops. */
export const memberPoseOf = (member: BandMember, t: number, seed: number): Hd2dPose => {
  const step = Math.floor(t / 220 + seed)
  const bob = member.state === 'working' ? step % 2 : 0
  const hop = member.state === 'waiting' ? Math.abs(Math.sin(t / 260 + seed)) * 3 : 0
  return {
    step,
    isSitting: member.state === 'idle' || member.state === 'done' || member.benched,
    isBenched: member.benched,
    lift: bob + hop
  }
}

const CONFETTI = [0xffd84a, 0x5fd3a0, 0xff7ab8] as const

/** A particle in camera space: x right and y up of the view centre, `distance` ahead of it. */
export const particleOf = (args: {
  i: number
  t: number
  raining: boolean
  merged: boolean
  pixels: number
  width: number
}): { x: number; y: number; distance: number; color: number } => {
  const { i, t, raining, merged, pixels } = args
  const half = args.width / 2
  const seed = ((i * 7919) % 1000) / 1000
  const fall = (t / (raining ? 700 : 4000) + seed * 7) % 1
  return {
    x: -half + seed * 2 * half + Math.sin(t / 1300 + i) * 2,
    y: raining || merged ? pixels / 2 - fall * pixels : Math.sin(t / 900 + i) * 3 - seed * 4,
    distance: DEPTH - (i % 3) * 6,
    color: raining ? 0x9fb4e6 : merged ? (CONFETTI[i % 3] ?? 0xffffff) : 0xfff6a0
  }
}

export const particlesShownOf = (model: Pick<BandModel, 'ci' | 'merged'>, night: number): boolean =>
  model.ci === 'failure' || model.merged || night > 0.5

/** The sun disc on the characters' plane, relative to the view centre (y up); it never scrolls. */
export const sunDiscOf = (
  sun: { x: number; y: number },
  pixels: number,
  aspect: number
): { x: number; y: number; size: number } => ({
  x: (sun.x / SAMPLES - 0.5) * pixels * aspect,
  y: pixels / 2 - sun.y,
  size: Math.max(5, pixels * 0.3)
})

/** three's linear Fog factor, which is a smoothstep over view depth. */
export const fogAt = (depth: number): number => {
  const k = Math.min(1, Math.max(0, (depth - FOG.near) / (FOG.far - FOG.near)))
  return k * k * (3 - 2 * k)
}
