import { describe, expect, it } from 'vitest'
import {
  GAME_ARCADE_CREDITS_MAX,
  NO_GAME_ARCADE_CREDITS,
  applyGameArcadeAction,
  earnGameArcadeCredit,
  laterGameArcadeCredits,
  parseGameArcadeCredits
} from './orchestrator-game-arcade-credits'

const perfect = {
  provider: 'gitlab' as const,
  number: 41,
  worktreeId: 'wt-1',
  perfect: true
}

describe('parseGameArcadeCredits', () => {
  it('reads a saved ledger and falls back to none for anything malformed', () => {
    expect(
      parseGameArcadeCredits({
        credits: 2,
        offer: { provider: 'github', number: 9 }
      })
    ).toEqual({ credits: 2, offer: { provider: 'github', number: 9 } })
    expect(parseGameArcadeCredits(undefined)).toEqual(NO_GAME_ARCADE_CREDITS)
    expect(
      parseGameArcadeCredits({
        credits: -3,
        offer: { provider: 'svn', number: 1 }
      })
    ).toEqual(NO_GAME_ARCADE_CREDITS)
    expect(parseGameArcadeCredits({ credits: 2.5, offer: null })).toEqual({
      credits: 2,
      offer: null
    })
    expect(parseGameArcadeCredits({ credits: 1e9 }).credits).toBe(GAME_ARCADE_CREDITS_MAX)
  })
})

describe('earnGameArcadeCredit', () => {
  it('saves one credit and offers the merge that earned it', () => {
    expect(earnGameArcadeCredit(NO_GAME_ARCADE_CREDITS, perfect)).toEqual({
      credits: 1,
      offer: { provider: 'gitlab', number: 41 }
    })
  })

  it('earns nothing for a merge that was not perfect', () => {
    const kept = { credits: 1, offer: null }
    expect(earnGameArcadeCredit(kept, { ...perfect, perfect: false })).toBe(kept)
  })

  it('stops counting at the cap but still offers the newest merge', () => {
    const full = { credits: GAME_ARCADE_CREDITS_MAX, offer: null }
    expect(earnGameArcadeCredit(full, perfect)).toEqual({
      credits: GAME_ARCADE_CREDITS_MAX,
      offer: { provider: 'gitlab', number: 41 }
    })
  })
})

describe('applyGameArcadeAction', () => {
  const offered = {
    credits: 2,
    offer: { provider: 'github' as const, number: 9 }
  }

  it('spends one credit to play and clears the offer', () => {
    expect(applyGameArcadeAction(offered, 'play')).toEqual({
      ok: true,
      next: { credits: 1, offer: null }
    })
  })

  it('refuses to play with no credit left', () => {
    expect(applyGameArcadeAction(NO_GAME_ARCADE_CREDITS, 'play')).toEqual({
      ok: false,
      next: NO_GAME_ARCADE_CREDITS
    })
  })

  it('keeps the credit for later and only clears the offer', () => {
    expect(applyGameArcadeAction(offered, 'keep')).toEqual({
      ok: true,
      next: { credits: 2, offer: null }
    })
  })
})

describe('laterGameArcadeCredits', () => {
  it('keeps the larger count, so adopting the same file twice adds nothing', () => {
    const current = { credits: 1, offer: null }
    const adopted = {
      credits: 3,
      offer: { provider: 'github' as const, number: 2 }
    }
    expect(laterGameArcadeCredits(current, adopted)).toEqual(adopted)
    expect(laterGameArcadeCredits(adopted, current)).toEqual(adopted)
  })
})
