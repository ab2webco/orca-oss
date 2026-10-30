import { ghSpendSince } from '../git/gh-spend-ledger'
import { getRateLimit } from '../github/rate-limit'
import {
  gameGitHubBudgetOf,
  type GameGitHubBudget
} from '../../shared/orchestrator-game-github-budget'

const HOUR_MS = 60 * 60 * 1000

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
  return gameGitHubBudgetOf({
    graphql: { ...graphql, orcaCalls: orcaCalls(graphql.resetAt, 'graphql') },
    core: { ...core, orcaCalls: orcaCalls(core.resetAt, 'core') },
    top: ghSpendSince(now - HOUR_MS, now).top
  })
}
