import { ADVISOR_PROP_WIDTH, advisorPropPixel } from './advisor-art'
import { GROUND } from './scenery'
import type { AdvisorGesture, CastFrame, SceneAdvisor, ScenePet } from './scenes/index'
import { restColumnOf, SPRITE_WIDTH, walkColumn } from './walk-path'

// The scene's cast beside the hero: the pet that trails it, and Jev's advisor at the right edge.

/** How far behind the hero the pet walks, in ticks of the hero's own path. */
export const PET_TRAIL_TICKS = 16

export const castWidthOf = (frame: CastFrame | undefined): number => frame?.[0]?.length ?? 0

/** A frame standing on the ground with its left edge at `left`, `lift` pixels up. */
export const castPixel = (
  frame: CastFrame,
  colors: Readonly<Record<string, number>>,
  x: number,
  y: number,
  left: number,
  lift = 0
): number | undefined => {
  const glyph = frame[y - (GROUND - frame.length - lift)]?.[x - left]
  return glyph === undefined || glyph === '.' ? undefined : colors[glyph]
}

export const petColumnOf = (
  pet: ScenePet,
  columns: number,
  tick: number,
  isResting: boolean
): number => {
  if (!isResting) {
    return walkColumn(columns, Math.max(0, tick - PET_TRAIL_TICKS))
  }
  const rest = restColumnOf(columns)
  const left = rest - castWidthOf(pet.frames[0]) - 1
  return left >= 0 ? left : rest + SPRITE_WIDTH + 1
}

export const petFrameOf = (
  pet: ScenePet,
  tick: number,
  isResting: boolean,
  isPetted: boolean
): CastFrame => {
  if (isPetted) {
    return pet.happy
  }
  const walking = pet.frames[Math.floor(tick / 3) % pet.frames.length]
  return (isResting ? pet.frames[0] : walking) ?? pet.happy
}

/** Jev's advisor as the scene draws it now: its sprite, the gesture playing and its words. */
export type AdvisorPose = {
  sprite: SceneAdvisor
  gesture?: AdvisorGesture
  /** Ticks since the gesture started. */
  age: number
  /** '' draws no bubble. */
  bubble: string
}

/** The columns the hero walks: all of them without Jev, else up to the advisor and its props. */
export const advisorStageOf = (columns: number, pose: AdvisorPose | undefined): number =>
  pose === undefined
    ? columns
    : Math.max(
        SPRITE_WIDTH + 1,
        columns - castWidthOf(pose.sprite.frames[0]) - ADVISOR_PROP_WIDTH - 1
      )

export const advisorFrameOf = (pose: AdvisorPose, tick: number): CastFrame => {
  const gestured = pose.gesture === undefined ? undefined : pose.sprite.gestures?.[pose.gesture]
  const frames = pose.sprite.frames
  return gestured ?? frames[Math.floor(tick / 8) % frames.length] ?? []
}

/** The advisor at the right edge with its gesture's prop held out in front of it. */
export const advisorPixel = (
  pose: AdvisorPose,
  columns: number,
  x: number,
  y: number,
  tick: number
): number | undefined => {
  const frame = advisorFrameOf(pose, tick)
  const left = columns - 1 - castWidthOf(frame)
  const body = castPixel(frame, pose.sprite.colors, x, y, left)
  if (body !== undefined || pose.gesture === undefined) {
    return body
  }
  return advisorPropPixel(pose.gesture, x - (left - ADVISOR_PROP_WIDTH), y, pose.age)
}
