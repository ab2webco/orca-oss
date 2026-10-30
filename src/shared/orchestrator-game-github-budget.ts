/** The account's github.com budget and Orca's own share of it, as the game reports it (ORCA-877). */

export type GameGitHubBucket = {
  limit: number
  remaining: number
  /** Unix epoch seconds when the window resets. */
  resetAt: number
  /** Orca's gh calls since the window started; the rest of `limit - remaining` is other tools'. */
  orcaCalls: number
}

export type GameGitHubBudget = {
  graphql: GameGitHubBucket
  core: GameGitHubBucket
  /** Orca's busiest call shapes this hour, most first. */
  top: { shape: string; bucket: 'core' | 'graphql' | 'search'; calls: number }[]
  /** A bucket is down to a fifth of its limit. */
  low: boolean
}

const LOW_SHARE = 0.2

// Why limit > 0: an unknown bucket reads 0/0 and must not raise the alarm.
export const gameGitHubBucketIsLow = (bucket: GameGitHubBucket): boolean =>
  bucket.limit > 0 && bucket.remaining < bucket.limit * LOW_SHARE

export function gameGitHubBudgetOf(budget: Omit<GameGitHubBudget, 'low'>): GameGitHubBudget {
  return {
    ...budget,
    low: gameGitHubBucketIsLow(budget.graphql) || gameGitHubBucketIsLow(budget.core)
  }
}

function resetsIn(resetAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((resetAt * 1000 - now) / 60_000))
  return `resets in ${minutes}m`
}

const bucketLine = (name: string, bucket: GameGitHubBucket, now: number): string =>
  `${name} ${bucket.remaining}/${bucket.limit} left, Orca made ${bucket.orcaCalls} calls (${resetsIn(bucket.resetAt, now)})`

export function formatGameGitHubBudget(
  budget: GameGitHubBudget,
  now: number = Date.now()
): string[] {
  const head = budget.low ? 'GitHub API LOW, game reads slowed 5x:' : 'GitHub API:'
  const top = budget.top.map((one) => `${one.shape} ${one.calls}`).join(' · ')
  return [
    `${head} ${bucketLine('GraphQL', budget.graphql, now)} · ${bucketLine('REST', budget.core, now)}`,
    ...(top ? [`Orca's busiest calls this hour: ${top}`] : [])
  ]
}
