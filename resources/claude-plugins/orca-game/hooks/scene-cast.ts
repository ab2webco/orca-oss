import { GROUND } from './scenery'
import type { CastFrame, ScenePet } from './scenes/index'
import { restColumnOf, SPRITE_WIDTH, walkColumn } from './walk-path'

// The scene's cast beside the hero: its pet, which trails it, and is what Pet hearts.

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
