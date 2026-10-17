import { ADVISOR_PROP_WIDTH, advisorPropPixel } from './advisor-art'
import { frameSpriteOf, hdSpritePixel, type HdSprite } from './hd-sprite'
import { advisorFrameOf, petFrameOf, type AdvisorPose } from './scene-cast'
import type { ScenePet } from './scenes/index'
import { GROUND } from './scenery'

// The scene's cast in hd: the pet trailing the hero and Jev's advisor at the right edge, both outlined
// and shaded from their own palettes like the hero.

export type PlacedCast = { sprite: HdSprite; left: number; top: number }

/** The columns the hero walks: all of them, or up to the outlined advisor and its prop. */
export const hdStageOf = (
  columns: number,
  pose: AdvisorPose | undefined,
  heroWidth: number
): number =>
  pose === undefined
    ? columns
    : Math.max(
        heroWidth + 1,
        columns - ((pose.sprite.frames[0]?.[0]?.length ?? 0) + 2) - ADVISOR_PROP_WIDTH - 1
      )

/** The pet right behind the walking hero, ahead of the party, or sitting just left of the resting hero. */
export const hdPetOf = (args: {
  pet: ScenePet
  tick: number
  isResting: boolean
  isPetted: boolean
  heroLeft: number
  heroWidth: number
  ground: number
  lift: number
}): PlacedCast => {
  const frame = petFrameOf(args.pet, args.tick, args.isResting, args.isPetted)
  const sprite = frameSpriteOf(frame, args.pet.colors)
  const behind = args.heroLeft - sprite.width
  const left = args.isResting ? (behind >= 0 ? behind : args.heroLeft + args.heroWidth) : behind - 1
  return { sprite, left, top: args.ground - sprite.rows.length + 1 - args.lift }
}

export const hdAdvisorOf = (
  pose: AdvisorPose,
  columns: number,
  ground: number,
  tick: number
): PlacedCast => {
  const sprite = frameSpriteOf(advisorFrameOf(pose, tick), pose.sprite.colors)
  return { sprite, left: columns - sprite.width, top: ground - sprite.rows.length + 1 }
}

export const castPixelOf = (
  cast: PlacedCast | undefined,
  x: number,
  y: number
): number | undefined =>
  cast === undefined ? undefined : hdSpritePixel(cast.sprite, x, y, cast.left, cast.top)

/** The advisor's gesture prop in front of it, its classic art lifted onto hd's ground line. */
export const hdAdvisorPropPixel = (
  pose: AdvisorPose,
  advisor: PlacedCast,
  x: number,
  y: number,
  ground: number
): number | undefined =>
  pose.gesture === undefined
    ? undefined
    : advisorPropPixel(
        pose.gesture,
        x - (advisor.left - ADVISOR_PROP_WIDTH),
        y - (ground - GROUND),
        pose.age
      )
