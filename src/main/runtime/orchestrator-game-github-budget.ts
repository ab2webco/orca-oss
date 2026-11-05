import { ghSpendSince } from '../git/gh-spend-ledger'
import { getRateLimit } from '../github/rate-limit'
import {
  gameGitHubBucketIsLow,
  gameGitHubBudgetOf,
  type GameGitHubBudget
} from '../../shared/orchestrator-game-github-budget'

const HOUR_MS = 60 * 60 * 1000
const LOW_BUDGET_POLL_STRETCH = 5
// Why: every pane polls game.state, and gh's exec deadline is 30 s; a stalled probe must not hold it (ORCA-1065).
export const GAME_GITHUB_BUDGET_WAIT_MS = 2_000

// Why kept from the last read: the game caches ask on every read and must not wait on gh.
let lowUntilMs = 0
let lastBudget: GameGitHubBudget | null = null

/** github.com's budget for the account Orca's gh uses, with Orca's own calls in each window. */
export async function readGameGitHubBudget(now = Date.now()): Promise<GameGitHubBudget | null> {
  const probe = probeGameGitHubBudget(now)
  let timer: ReturnType<typeof setTimeout> | undefined
  // Why the last budget on a stall: the probe keeps running single-flight and the next read gets it.
  const stalled = new Promise<GameGitHubBudget | null>((resolve) => {
    timer = setTimeout(() => resolve(lastBudget), GAME_GITHUB_BUDGET_WAIT_MS)
  })
  try {
    return await Promise.race([probe, stalled])
  } finally {
    clearTimeout(timer)
  }
}

async function probeGameGitHubBudget(now: number): Promise<GameGitHubBudget | null> {
  // Why cheap enough per game poll: the probe is exempt from the limit and cached for 30 s.
  const result = await getRateLimit()
  if (!result.ok) {
    lastBudget = null
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
  lastBudget = budget
  return budget
}

/** How many times longer the game's GitHub reads are cached: stretched until a low bucket resets. */
export function gameGitHubPollStretch(now = Date.now()): number {
  return now < lowUntilMs ? LOW_BUDGET_POLL_STRETCH : 1
}
