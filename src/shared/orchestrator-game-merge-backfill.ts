import {
  creditGameMerge,
  GAME_CHARACTER_XP,
  paidGameMergeNumbers,
  prNumberOf
} from './orchestrator-game-characters'
import type { GameMergedReview } from './orchestrator-game-delivery'
import type { GameHistoryRecord } from './orchestrator-game-history'

// Why (ORCA-1210): a member freed before its PR merged leaves `pr: null` or a stopped
// `#N merged`, which neither the free nor the late look (ORCA-1170) ever pays.

/** One merge the backfill paid. */
export type GameMergeBackfill = { character: string; ticket: string; number: number; xp: number }

type Worked = GameHistoryRecord & { ticket: string; character: string }

const workedOf = (record: GameHistoryRecord): record is Worked =>
  Boolean(record.ticket && record.character?.trim())

const startOf = (record: GameHistoryRecord): number =>
  Date.parse(record.launchedAt ?? record.endedAt)

/** The free that opened `review`: one that names its PR first, then the newest started before it merged. */
function openerOf(candidates: readonly Worked[], review: GameMergedReview): Worked | undefined {
  const named = candidates.filter((one) => prNumberOf(one.pr) === review.number)
  const pool = named.length > 0 ? named : candidates
  const merged = Date.parse(review.mergedAt)
  const before = pool.filter((one) => !(startOf(one) > merged))
  return (before.length > 0 ? before : pool).toSorted((a, b) =>
    b.endedAt.localeCompare(a.endedAt)
  )[0]
}

/**
 * The stored characters with each merged PR its title's ticket names paid to the freed member
 * that worked it, minus what that member's frees of the ticket already paid; one PR pays once.
 * `next` is null when nothing was paid. `keyOf` gives a shown name's roster key.
 */
export function backfillGameMerges(
  stored: Record<string, unknown>,
  records: readonly GameHistoryRecord[],
  merged: readonly GameMergedReview[],
  keyOf: (name: string) => string
): { next: Record<string, unknown> | null; paid: GameMergeBackfill[] } {
  const byTicket = new Map<string, Worked[]>()
  for (const record of records.filter(workedOf)) {
    const ticket = record.ticket.toUpperCase()
    byTicket.set(ticket, [...(byTicket.get(ticket) ?? []), record])
  }
  let next = stored
  const paid: GameMergeBackfill[] = []
  const already = paidGameMergeNumbers(stored)
  for (const review of merged.toSorted((a, b) => a.mergedAt.localeCompare(b.mergedAt))) {
    if (already.has(review.number)) {
      continue
    }
    // Why: a free whose PR is another number did not open this one.
    const candidates = (review.tickets ?? [])
      .flatMap((ticket) => byTicket.get(ticket.toUpperCase()) ?? [])
      .filter((one) => [null, review.number].includes(prNumberOf(one.pr)))
    // Why: a free that ended `merged` already paid its 100, with no PR number to settle.
    if (candidates.some((one) => one.outcome === 'merged')) {
      continue
    }
    const opener = openerOf(candidates, review)
    if (!opener) {
      continue
    }
    const name = opener.character.trim()
    const key = keyOf(name)
    const earned = candidates
      .filter((one) => keyOf(one.character.trim()) === key)
      .reduce((sum, one) => sum + GAME_CHARACTER_XP[one.outcome], 0)
    const ticket = opener.ticket.toUpperCase()
    const credited = creditGameMerge(
      next,
      { key, name },
      { ticket, number: review.number, at: review.mergedAt },
      earned
    )
    if (!credited) {
      continue
    }
    const xpOf = (from: Record<string, unknown>): number =>
      (from[key] as { xp?: number } | undefined)?.xp ?? 0
    paid.push({ character: name, ticket, number: review.number, xp: xpOf(credited) - xpOf(next) })
    already.add(review.number)
    next = credited
  }
  return { next: paid.length > 0 ? next : null, paid }
}
