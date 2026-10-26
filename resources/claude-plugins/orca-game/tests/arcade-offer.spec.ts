import { afterEach, describe, expect, it } from 'vitest'

import { arcadeCaptionOf } from '../hooks/arcade-loop'
import { ARCADE_OFFER_SECONDS, arcadeCountdownOf, arcadeOfferLineOf } from '../hooks/arcade-offer'
import { gameCommandOf } from '../hooks/game-commands'
import { setGameLocale } from '../hooks/game-strings'
import { questCommandOf } from '../hooks/quest-policy'
import { fakeClock } from './arcade-clock'

afterEach(() => setGameLocale('en'))

const countdownFor = (isHeld = () => false) => {
  const { clock, advance, timers } = fakeClock()
  const lines: { left: number; isHeld: boolean }[] = []
  let expired = 0
  const countdown = arcadeCountdownOf({
    seconds: ARCADE_OFFER_SECONDS,
    clock,
    isHeld,
    draw: (left, held) => lines.push({ left, isHeld: held }),
    expire: () => {
      expired += 1
    }
  })
  return { countdown, advance, timers, lines, expired: () => expired }
}

describe('the arcade offer', () => {
  it('is the demo command with the word offer, from both commands', () => {
    expect(gameCommandOf('orca-game:demo', 'offer')).toEqual({ arcade: true, isOffer: true })
    expect(questCommandOf('demo offer')).toEqual({ arcade: true, isOffer: true })
    expect(gameCommandOf('orca-game:demo', 'arcade')).toEqual({ arcade: true })
  })

  it('counts down once a second and expires at zero with no timer left', async () => {
    const { advance, timers, lines, expired } = countdownFor()
    expect(lines).toEqual([{ left: ARCADE_OFFER_SECONDS, isHeld: false }])
    await advance(3000)
    expect(lines.at(-1)).toEqual({ left: ARCADE_OFFER_SECONDS - 3, isHeld: false })
    await advance((ARCADE_OFFER_SECONDS - 3) * 1000)
    expect(expired()).toBe(1)
    expect(timers.size).toBe(0)
    await advance(10_000)
    expect(expired()).toBe(1)
  })

  it('stands still while someone needs the user and goes on once answered', async () => {
    let isHeld = false
    const { advance, lines, expired } = countdownFor(() => isHeld)
    await advance(2000)
    isHeld = true
    await advance(60_000)
    expect(expired()).toBe(0)
    expect(lines.at(-1)).toEqual({ left: ARCADE_OFFER_SECONDS - 2, isHeld: true })
    isHeld = false
    await advance(1000)
    expect(lines.at(-1)).toEqual({ left: ARCADE_OFFER_SECONDS - 3, isHeld: false })
  })

  it('leaves no timer and never expires once stopped', async () => {
    const { countdown, advance, timers, expired } = countdownFor()
    countdown.stop()
    expect(timers.size).toBe(0)
    await advance(60_000)
    expect(expired()).toBe(0)
  })

  it('says the seconds left and the held state in both languages', () => {
    for (const locale of ['en', 'es'] as const) {
      setGameLocale(locale)
      expect(arcadeOfferLineOf(12, false), locale).toContain('12')
      expect(arcadeOfferLineOf(12, true), locale).not.toBe(arcadeOfferLineOf(12, false))
      expect(arcadeCaptionOf('held', 3), locale).toBeDefined()
    }
  })
})
