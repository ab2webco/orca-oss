import { afterEach, describe, expect, it, vi } from 'vitest'

const { getRateLimitMock } = vi.hoisted(() => ({ getRateLimitMock: vi.fn() }))

vi.mock('../github/rate-limit', () => ({ getRateLimit: getRateLimitMock }))

import { gameGitHubPollStretch, readGameGitHubBudget } from './orchestrator-game-github-budget'
import { _resetGhSpendLedger, recordGhSpend } from '../git/gh-spend-ledger'

const NOW = 1_800_000_000_000
const bucket = (remaining: number, resetInMin: number) => ({
  limit: 5000,
  remaining,
  resetAt: NOW / 1000 + resetInMin * 60
})

afterEach(() => {
  _resetGhSpendLedger()
  getRateLimitMock.mockReset()
})

describe('readGameGitHubBudget', () => {
  it("counts Orca's calls since each bucket's window started", async () => {
    getRateLimitMock.mockResolvedValue({
      ok: true,
      snapshot: {
        graphql: bucket(800, 10),
        core: bucket(4900, 50),
        search: bucket(30, 1),
        fetchedAt: NOW
      }
    })
    // GraphQL's window started 50 minutes ago, REST's 10 minutes ago.
    recordGhSpend(['pr', 'checks', '1'], 'graphql', NOW - 55 * 60_000)
    recordGhSpend(['pr', 'checks', '1'], 'graphql', NOW - 40 * 60_000)
    recordGhSpend(['api', 'repos/a/b/pulls/1'], 'core', NOW - 20 * 60_000)
    recordGhSpend(['api', 'repos/a/b/pulls/1'], 'core', NOW - 5 * 60_000)

    const budget = await readGameGitHubBudget(NOW)

    expect(budget).toMatchObject({
      graphql: { remaining: 800, orcaCalls: 1 },
      core: { remaining: 4900, orcaCalls: 1 },
      low: true
    })
    expect(budget?.top).toEqual([
      { shape: 'api repos/:owner/:repo/pulls/:n', bucket: 'core', calls: 2 },
      { shape: 'pr checks', bucket: 'graphql', calls: 2 }
    ])
  })

  it('is null when the budget cannot be read', async () => {
    getRateLimitMock.mockResolvedValue({ ok: false, error: 'gh: not logged in' })
    expect(await readGameGitHubBudget(NOW)).toBeNull()
  })
})

describe('gameGitHubPollStretch', () => {
  it('stretches game polls while a low bucket waits for its reset, and not after', async () => {
    getRateLimitMock.mockResolvedValue({
      ok: true,
      snapshot: {
        graphql: bucket(800, 10),
        core: bucket(4900, 50),
        search: bucket(30, 1),
        fetchedAt: NOW
      }
    })
    await readGameGitHubBudget(NOW)

    expect(gameGitHubPollStretch(NOW)).toBe(5)
    expect(gameGitHubPollStretch(NOW + 11 * 60_000)).toBe(1)
  })

  it('leaves game polls alone with budget to spare', async () => {
    getRateLimitMock.mockResolvedValue({
      ok: true,
      snapshot: {
        graphql: bucket(4000, 10),
        core: bucket(4900, 50),
        search: bucket(30, 1),
        fetchedAt: NOW
      }
    })
    await readGameGitHubBudget(NOW)

    expect(gameGitHubPollStretch(NOW)).toBe(1)
  })
})
