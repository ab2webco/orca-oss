import { ADVISOR_PROP_WIDTH } from './advisor-art'
import { FIRE_WIDTH } from './hd-party'

// What the hd band keeps as the pane narrows. Teammates go first (hdTrailOf), then the pet, then the
// advisor's gesture, then the advisor; the hero with its fire or prop, crown, label and caption stay.

export type HdBandRoom = {
  /** The columns the hero, its pet and the party walk in, left of the advisor. */
  stage: number
  isPetShown: boolean
  isGestureShown: boolean
  isAdvisorShown: boolean
}

/** The hero and its campfire with a column either side; its walking prop is narrower. */
export const hdHeroRoomOf = (heroWidth: number): number => heroWidth + FIRE_WIDTH + 2

export const hdBandRoomOf = (args: {
  columns: number
  heroWidth: number
  /** 0 without a pet. */
  petWidth: number
  advisorWidth: number | undefined
  hasGesture: boolean
}): HdBandRoom => {
  const { columns, advisorWidth } = args
  const hero = hdHeroRoomOf(args.heroWidth)
  const pet = args.petWidth === 0 ? 0 : args.petWidth + 1
  const advisor = advisorWidth === undefined ? undefined : advisorWidth + 1
  const options: readonly Omit<HdBandRoom, 'stage'>[] = [
    { isPetShown: pet > 0, isGestureShown: args.hasGesture, isAdvisorShown: advisor !== undefined },
    { isPetShown: false, isGestureShown: args.hasGesture, isAdvisorShown: advisor !== undefined },
    { isPetShown: false, isGestureShown: false, isAdvisorShown: advisor !== undefined },
    { isPetShown: false, isGestureShown: false, isAdvisorShown: false }
  ]
  const stageOf = (option: Omit<HdBandRoom, 'stage'>): number =>
    columns -
    (option.isAdvisorShown ? (advisor ?? 0) : 0) -
    (option.isAdvisorShown && option.isGestureShown ? ADVISOR_PROP_WIDTH : 0)
  const fits = options.find(
    (option) => stageOf(option) >= hero + (option.isPetShown ? pet : 0)
  ) ?? { isPetShown: false, isGestureShown: false, isAdvisorShown: false }
  return { stage: stageOf(fits), ...fits }
}

/** A third of the way along the stage, with the pet's room on its left and its fire inside. */
export const hdRestColumnOf = (stage: number, heroWidth: number, petRoom = 0): number =>
  Math.max(
    0,
    Math.min(
      Math.max(petRoom, Math.floor((stage - heroWidth) / 3)),
      stage - hdHeroRoomOf(heroWidth)
    )
  )
