import type { ArcadeClock } from './arcade-loop'
import { arcadeWords } from './arcade-words'

// The offer's countdown: one timer a second while it waits on an answer, none once answered or gone.

export const ARCADE_OFFER_SECONDS = 15
const SECOND_MS = 1000

/**
 * The line under the offer: seconds left, or that it waits while someone needs the user. Without
 * the keyboard it names the chord that reaches the pane, since j and n would go to the prompt.
 */
export const arcadeOfferLineOf = (left: number, isHeld: boolean, isFocused = true): string => {
  const words = arcadeWords()
  if (isHeld) {
    return words.offerHeld(left)
  }
  return isFocused ? words.offerLeft(left) : `${words.offerLeft(left)} · ${words.offerReach}`
}

export type ArcadeCountdown = { stop: () => void }

export const arcadeCountdownOf = (args: {
  seconds: number
  clock: Pick<ArcadeClock, 'every'>
  /** As the loop's: while true the countdown stands still. */
  isHeld: () => boolean
  draw: (left: number, isHeld: boolean) => void
  expire: () => void
}): ArcadeCountdown => {
  let left = args.seconds
  const timer = args.clock.every(SECOND_MS, () => {
    if (args.isHeld()) {
      args.draw(left, true)
      return
    }
    left -= 1
    if (left <= 0) {
      timer.cancel()
      args.expire()
      return
    }
    args.draw(left, false)
  })
  args.draw(left, false)
  return { stop: () => timer.cancel() }
}
