import { describe, expect, it } from 'vitest'
import {
  formatGameGitHubBudget,
  gameGitHubBudgetOf,
  type GameGitHubBudget
} from './orchestrator-game-github-budget'

const NOW = 1_800_000_000_000
const RESET = NOW / 1000 + 23 * 60

const budget = (graphqlRemaining: number): GameGitHubBudget =>
  gameGitHubBudgetOf({
    graphql: { limit: 5000, remaining: graphqlRemaining, resetAt: RESET, orcaCalls: 310 },
    core: { limit: 5000, remaining: 4300, resetAt: RESET, orcaCalls: 20 },
    top: [
      { shape: 'pr checks', bucket: 'graphql', calls: 120 },
      { shape: 'api graphql PullRequestReviewFacts', bucket: 'graphql', calls: 90 }
    ]
  })

describe('gameGitHubBudgetOf', () => {
  it('is low once a bucket has a fifth of its limit left', () => {
    expect(budget(1001).low).toBe(false)
    expect(budget(999).low).toBe(true)
  })

  it('is not low on an unknown bucket', () => {
    expect(
      gameGitHubBudgetOf({
        graphql: { limit: 0, remaining: 0, resetAt: RESET, orcaCalls: 0 },
        core: { limit: 0, remaining: 0, resetAt: RESET, orcaCalls: 0 },
        top: []
      }).low
    ).toBe(false)
  })
})

describe('formatGameGitHubBudget', () => {
  it("prints each bucket's budget, Orca's calls in the window and its busiest calls", () => {
    expect(formatGameGitHubBudget(budget(4100), NOW)).toEqual([
      'GitHub API: GraphQL 4100/5000 left, Orca made 310 calls (resets in 23m) · REST 4300/5000 left, Orca made 20 calls (resets in 23m)',
      "Orca's busiest calls this hour: pr checks 120 · api graphql PullRequestReviewFacts 90"
    ])
  })

  it('leads with a warning when the budget is low', () => {
    expect(formatGameGitHubBudget(budget(400), NOW)[0]).toMatch(
      /^GitHub API LOW: GraphQL 400\/5000 left/
    )
  })
})
