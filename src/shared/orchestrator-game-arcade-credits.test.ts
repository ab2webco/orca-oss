import { describe, expect, it } from 'vitest'
import {
  GAME_ARCADE_CREDITS_MAX,
  NO_GAME_ARCADE_CREDITS,
  applyGameArcadeAction,
  earnGameArcadeCredit,
  laterGameArcadeCredits,
  migrateGameArcadeOffers,
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

describe('migrateGameArcadeOffers', () => {
  it('pays each offer the terminal kept once and records it', () => {
    const migrated = migrateGameArcadeOffers(
      { credits: 1, offer: null },
      ['r-1'],
      ['r-1', 'r-2', 'r-3', 'r-3']
    )
    expect(migrated).toEqual({
      next: { credits: 3, offer: null },
      seen: ['r-1', 'r-2', 'r-3'],
      paid: 2
    })
    expect(migrateGameArcadeOffers(migrated.next, migrated.seen, ['r-2', 'r-3']).paid).toBe(0)
  })

  it('stops paying at the cap but still records every offer, so none pays later', () => {
    const offers = Array.from({ length: 12 }, (_, at) => `r-${at}`)
    const migrated = migrateGameArcadeOffers({ credits: 7, offer: null }, [], offers)
    expect(migrated.next.credits).toBe(GAME_ARCADE_CREDITS_MAX)
    expect(migrated.paid).toBe(2)
    expect(migrated.seen).toEqual(offers)
  })

  it('ignores what is not an offer id', () => {
    const migrated = migrateGameArcadeOffers(
      NO_GAME_ARCADE_CREDITS,
      [],
      ['', 'x'.repeat(201), 'r-1']
    )
    expect(migrated.seen).toEqual(['r-1'])
    expect(migrated.paid).toBe(1)
  })
})
