import { describe, expect, it, vi } from 'vitest'
import { GameBranchReviews } from './orchestrator-game-branch-reviews'

const open = { number: 1266, state: 'open' }
const closed = { number: 1179, state: 'closed' }
const badGateway = new Error('GitHub PR lookup failed (server_error): HTTP 502: Bad Gateway')

describe("the game reads a branch's review before a known number (ORCA-1435)", () => {
  it("answers the branch's open PR and never asks for the known closed one", async () => {
    const reviews = new GameBranchReviews<typeof open>()
    const byNumber = vi.fn(async () => closed)

    await expect(reviews.read('b', { byBranch: async () => open, byNumber })).resolves.toBe(open)
    expect(byNumber).not.toHaveBeenCalled()
  })

  it('asks for the known number only after the branch cleanly has no PR', async () => {
    const reviews = new GameBranchReviews<typeof open>()

    await expect(
      reviews.read('b', { byBranch: async () => null, byNumber: async () => closed })
    ).resolves.toBe(closed)
  })

  it('keeps the last good open PR when GitHub fails, instead of the closed one', async () => {
    const reviews = new GameBranchReviews<typeof open>()
    const byNumber = vi.fn(async () => closed)
    await reviews.read('b', { byBranch: async () => open, byNumber })

    await expect(
      reviews.read('b', {
        byBranch: async () => {
          throw badGateway
        },
        byNumber
      })
    ).resolves.toBe(open)
    expect(byNumber).not.toHaveBeenCalled()
  })

  it('fails a first read GitHub cannot answer, so no guess stands in for it', async () => {
    const reviews = new GameBranchReviews<typeof open>()

    await expect(
      reviews.read('b', {
        byBranch: async () => {
          throw badGateway
        },
        byNumber: async () => closed
      })
    ).rejects.toThrow(/502/)
  })
})
