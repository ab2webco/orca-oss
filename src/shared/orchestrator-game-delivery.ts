import {
  GAME_METRICS_DAYS,
  gameDayKeyOf,
  type GameMetricsSummary
} from './orchestrator-game-metrics-summary'

/** The project's merged PRs as its review provider lists them (ORCA-950). */

export type GameDeliveryProvider = 'github' | 'gitlab'

export type GameMergedReview = { number: number; openedAt: string; mergedAt: string }

export type GameDelivery = {
  provider: GameDeliveryProvider
  /** `owner/repo` on GitHub, the project path on GitLab. */
  repo: string
  fetchedAt: string
  /** Every review merged at or after this is in `reviews`, unless `complete` is false. */
  since: string
  reviews: GameMergedReview[]
  /** False when the provider had more than the pages read. */
  complete: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

// Why every few minutes: merges move by the minute, and each read costs the shared GitHub budget.
export const GAME_DELIVERY_REFRESH_MS = 5 * 60_000
// Why a day more than the widget: one read then covers its 14 days in any zone.
export const GAME_DELIVERY_LOOKBACK_MS = (GAME_METRICS_DAYS + 1) * DAY_MS
export const GAME_DELIVERY_PAGE_SIZE = 100
export const GAME_DELIVERY_PAGES_MAX = 10

export const gameDeliverySinceOf = (now: number): string =>
  new Date(now - GAME_DELIVERY_LOOKBACK_MS).toISOString()

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** The summary with merged-per-day and lead time (PR open to merge) taken from the provider. */
export function withGameDelivery(
  summary: GameMetricsSummary,
  delivery: GameDelivery
): GameMetricsSummary {
  const days = new Set(summary.mergedPerDay.map((one) => one.day))
  const merged = new Map<string, number>()
  const durations: number[] = []
  for (const review of delivery.reviews) {
    const mergedAt = Date.parse(review.mergedAt)
    const day = gameDayKeyOf(mergedAt, summary.timezone)
    if (!days.has(day)) {
      continue
    }
    merged.set(day, (merged.get(day) ?? 0) + 1)
    const openedAt = Date.parse(review.openedAt)
    if (Number.isFinite(openedAt) && openedAt <= mergedAt) {
      durations.push(mergedAt - openedAt)
    }
  }
  return {
    ...summary,
    mergedPerDay: summary.mergedPerDay.map(({ day }) => ({ day, merged: merged.get(day) ?? 0 })),
    leadTime: { medianMs: median(durations), measured: durations.length },
    source: {
      kind: delivery.provider,
      repo: delivery.repo,
      fetchedAt: delivery.fetchedAt,
      ...(delivery.complete ? {} : { partial: true })
    }
  }
}

const fieldsOf = (item: unknown): Record<string, unknown> =>
  typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}

const isoOf = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null

/** A GitHub `search/issues` page's merged PRs; an item without `merged_at` is not one. */
export function gameMergedReviewsOfGitHubSearch(items: readonly unknown[]): GameMergedReview[] {
  return items.flatMap((item) => {
    const one = fieldsOf(item)
    const mergedAt = isoOf(fieldsOf(one.pull_request).merged_at)
    const openedAt = isoOf(one.created_at)
    return typeof one.number === 'number' && mergedAt && openedAt
      ? [{ number: one.number, openedAt, mergedAt }]
      : []
  })
}

/** A GitLab `merge_requests` page's merged MRs. */
export function gameMergedReviewsOfGitLab(items: readonly unknown[]): GameMergedReview[] {
  return items.flatMap((item) => {
    const one = fieldsOf(item)
    const mergedAt = isoOf(one.merged_at)
    const openedAt = isoOf(one.created_at)
    return typeof one.iid === 'number' && mergedAt && openedAt
      ? [{ number: one.iid, openedAt, mergedAt }]
      : []
  })
}

/** Reads pages until one is short, the provider's total is reached, or the page cap. */
export async function gameDeliveryOf(args: {
  provider: GameDeliveryProvider
  repo: string
  since: string
  now: number
  readPage: (page: number) => Promise<{ reviews: GameMergedReview[]; total: number | null }>
}): Promise<GameDelivery> {
  const byNumber = new Map<number, GameMergedReview>()
  let complete = false
  for (let page = 1; page <= GAME_DELIVERY_PAGES_MAX; page += 1) {
    const { reviews, total } = await args.readPage(page)
    for (const review of reviews) {
      byNumber.set(review.number, review)
    }
    if (reviews.length < GAME_DELIVERY_PAGE_SIZE || (total !== null && byNumber.size >= total)) {
      complete = true
      break
    }
  }
  const since = Date.parse(args.since)
  return {
    provider: args.provider,
    repo: args.repo,
    fetchedAt: new Date(args.now).toISOString(),
    since: args.since,
    // Why filtered: GitLab can only narrow by update time, so older merges ride along.
    reviews: [...byNumber.values()].filter((one) => Date.parse(one.mergedAt) >= since),
    complete
  }
}
