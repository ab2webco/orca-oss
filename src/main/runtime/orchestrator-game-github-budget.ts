import { ghSpendSince } from '../git/gh-spend-ledger'
import { getRateLimit } from '../github/rate-limit'
import {
  gameGitHubBucketIsLow,
  gameGitHubBudgetOf,
  type GameGitHubBudget
} from '../../shared/orchestrator-game-github-budget'

const HOUR_MS = 60 * 60 * 1000
const LOW_BUDGET_POLL_STRETCH = 5

// Why kept from the last read: the game caches ask on every read and must not wait on gh.
let lowUntilMs = 0

/** github.com's budget for the account Orca's gh uses, with Orca's own calls in each window. */
export async function readGameGitHubBudget(now = Date.now()): Promise<GameGitHubBudget | null> {
  // Why cheap enough per game poll: the probe is exempt from the limit and cached for 30 s.
  const result = await getRateLimit()
  if (!result.ok) {
    return null
  }
  const { graphql, core } = result.snapshot
  // Why: GitHub's window is the hour that ends at the bucket's reset.
  const orcaCalls = (resetAt: number, bucket: 'graphql' | 'core'): number =>
    ghSpendSince(resetAt * 1000 - HOUR_MS, now).calls[bucket]
  const budget = gameGitHubBudgetOf({
    graphql: { ...graphql, orcaCalls: orcaCalls(graphql.resetAt, 'graphql') },
    core: { ...core, orcaCalls: orcaCalls(core.resetAt, 'core') },
    top: ghSpendSince(now - HOUR_MS, now).top
  })
  lowUntilMs = Math.max(
    0,
    ...[budget.graphql, budget.core].filter(gameGitHubBucketIsLow).map((one) => one.resetAt * 1000)
  )
  return budget
}

/** How many times longer the game's GitHub reads are cached: stretched until a low bucket resets. */
export function gameGitHubPollStretch(now = Date.now()): number {
  return now < lowUntilMs ? LOW_BUDGET_POLL_STRETCH : 1
}
