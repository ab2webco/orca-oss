import { median } from './orchestrator-game-metrics'
import {
  GAME_METRICS_DAYS,
  gameDayKeyOf,
  type GameMetricsSummary
} from './orchestrator-game-metrics-summary'

/** The project's merged PRs as its review provider lists them (ORCA-950). */
export type GameMergedReview = { number: number; openedAt: string; mergedAt: string }

export type GameDelivery = {
  provider: 'github' | 'gitlab'
  /** `owner/repo` on GitHub, the project path on GitLab. */
  repo: string
  fetchedAt: string
  since: string
  reviews: GameMergedReview[]
  /** False when the provider had more than the pages read. */
  complete: boolean
}

// Why every few minutes: merges move by the minute, and each read costs the shared GitHub budget.
export const GAME_DELIVERY_REFRESH_MS = 5 * 60_000
export const GAME_DELIVERY_PAGE_SIZE = 100
export const GAME_DELIVERY_PAGES_MAX = 10

// Why a day more than the widget: one read then covers its 14 days in any zone.
export const gameDeliverySinceOf = (now: number): string =>
  new Date(now - (GAME_METRICS_DAYS + 1) * 86_400_000).toISOString()

/** The summary with merged-per-day and lead time (PR open to merge) taken from the provider. */
export function withGameDelivery(summary: GameMetricsSummary, delivery: GameDelivery) {
  const merged = new Map(summary.mergedPerDay.map(({ day }) => [day, 0]))
  const durations: number[] = []
  for (const { openedAt, mergedAt } of delivery.reviews) {
    const day = gameDayKeyOf(Date.parse(mergedAt), summary.timezone)
    const count = merged.get(day)
    if (count !== undefined) {
      merged.set(day, count + 1)
      durations.push(Math.max(0, Date.parse(mergedAt) - Date.parse(openedAt)))
    }
  }
  const { provider: kind, repo, fetchedAt } = delivery
  return {
    ...summary,
    mergedPerDay: [...merged].map(([day, count]) => ({ day, merged: count })),
    leadTime: { medianMs: median(durations), measured: durations.length },
    source: { kind, repo, fetchedAt, ...(delivery.complete ? {} : { partial: true as const }) }
  } satisfies GameMetricsSummary
}

const fieldsOf = (item: unknown): Record<string, unknown> =>
  typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
const isoOf = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null

/** A provider page's merged reviews: GitHub search items, or GitLab merge requests. */
export function gameMergedReviewsOf(
  items: readonly unknown[],
  provider: GameDelivery['provider']
): GameMergedReview[] {
  return items.flatMap((item) => {
    const one = fieldsOf(item)
    const number = provider === 'github' ? one.number : one.iid
    const openedAt = isoOf(one.created_at)
    const mergedAt = isoOf(
      provider === 'github' ? fieldsOf(one.pull_request).merged_at : one.merged_at
    )
    return typeof number === 'number' && openedAt && mergedAt
      ? [{ number, openedAt, mergedAt }]
      : []
  })
}

/** Reads pages until one is short, the provider's total is reached, or the page cap. */
export async function gameDeliveryOf(
  base: Pick<GameDelivery, 'provider' | 'repo' | 'since'> & { now: number },
  readPage: (page: number) => Promise<{ items: unknown[]; total: number | null }>
): Promise<GameDelivery> {
  const byNumber = new Map<number, GameMergedReview>()
  let complete = false
  for (let page = 1; page <= GAME_DELIVERY_PAGES_MAX && !complete; page += 1) {
    const { items, total } = await readPage(page)
    for (const review of gameMergedReviewsOf(items, base.provider)) {
      byNumber.set(review.number, review)
    }
    complete = items.length < GAME_DELIVERY_PAGE_SIZE || (total !== null && byNumber.size >= total)
  }
  const { now, ...rest } = base
  // Why filtered: GitLab can only narrow by update time, so older merges ride along.
  const since = Date.parse(base.since)
  const reviews = [...byNumber.values()].filter((one) => Date.parse(one.mergedAt) >= since)
  return { ...rest, fetchedAt: new Date(now).toISOString(), reviews, complete }
}
