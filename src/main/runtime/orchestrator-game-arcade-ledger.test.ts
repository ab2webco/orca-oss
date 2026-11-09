import { describe, expect, it } from 'vitest'
import { GameArcadeLedger } from './orchestrator-game-arcade-ledger'
import type { GameBoardProject } from './orchestrator-game-board'
import type { GameArcadeCredits } from '../../shared/orchestrator-game-arcade-credits'

function ledgerWith(start: GameArcadeCredits, isMember = false) {
  let saved = start
  const paidIds = new Set<string>()
  const changed: string[] = []
  const project: GameBoardProject = {
    key: 'repo:r1',
    isMember,
    memberTicket: null,
    lead: null
  }
  const ledger = new GameArcadeLedger({
    store: {
      arcade: async () => saved,
      changeArcade: async (_key, change) => {
        const { next, result } = change(saved)
        saved = next ?? saved
        return result
      },
      migrateArcadeOffers: async (_key, offers) => {
        const fresh = offers.filter(
          (one): one is string => typeof one === 'string' && !paidIds.has(one)
        )
        fresh.forEach((one) => paidIds.add(one))
        saved = { ...saved, credits: saved.credits + fresh.length }
        return { paid: fresh.length, arcade: saved }
      }
    },
    projectOf: async () => project,
    changed: (key) => changed.push(key)
  })
  return { ledger, saved: () => saved, changed }
}

const offered: GameArcadeCredits = {
  credits: 1,
  offer: { provider: 'github', number: 9 }
}

describe('GameArcadeLedger', () => {
  it("reads the lead's project credits, and none for a member", async () => {
    expect(await ledgerWith(offered).ledger.read({ worktreeId: 'wt' })).toEqual(offered)
    expect(await ledgerWith(offered, true).ledger.read({ worktreeId: 'wt' })).toBeNull()
  })

  it('spends a credit to play and tells listeners once', async () => {
    const { ledger, saved, changed } = ledgerWith(offered)
    await expect(ledger.apply({ worktreeId: 'wt' }, 'play')).resolves.toEqual({
      ok: true,
      arcade: { credits: 0, offer: null }
    })
    expect(saved()).toEqual({ credits: 0, offer: null })
    expect(changed).toEqual(['repo:r1'])
  })

  it('refuses a play with no credit and writes nothing', async () => {
    const { ledger, changed } = ledgerWith({ credits: 0, offer: null })
    await expect(ledger.apply({ worktreeId: 'wt' }, 'play')).resolves.toEqual({
      ok: false,
      arcade: { credits: 0, offer: null }
    })
    expect(changed).toEqual([])
  })

  it('never lets a member spend its lead credits', async () => {
    await expect(
      ledgerWith(offered, true).ledger.apply({ worktreeId: 'wt' }, 'play')
    ).rejects.toThrow(/lead/)
  })

  it("pays the terminal's kept offers into the lead's project and tells listeners only when it paid", async () => {
    const { ledger, changed } = ledgerWith({ credits: 0, offer: null })
    await expect(ledger.migrate({ worktreeId: 'wt' }, ['r-1', 'r-2'])).resolves.toEqual({
      ok: true,
      paid: 2,
      arcade: { credits: 2, offer: null }
    })
    await expect(ledger.migrate({ worktreeId: 'wt' }, ['r-1'])).resolves.toMatchObject({ paid: 0 })
    expect(changed).toEqual(['repo:r1'])
    await expect(
      ledgerWith(offered, true).ledger.migrate({ worktreeId: 'wt' }, ['r-1'])
    ).rejects.toThrow(/lead/)
  })
})
