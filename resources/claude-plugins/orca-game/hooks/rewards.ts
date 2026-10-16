import type { GameReview, GameState } from '../types'
import type { Level } from './fleet-hud'
import { gameStrings } from './game-strings'

export type RewardKind = 'review-merged' | 'ci-green' | 'work-item-review' | 'work-item-done'

export const XP_BY_REWARD: Readonly<Record<RewardKind, number>> = {
  'review-merged': 100,
  'ci-green': 20,
  'work-item-review': 50,
  'work-item-done': 70
}

export type Reward = { id: string; kind: RewardKind; xp: number; label: string }

export type XpLedger = { total: number; awards: Record<string, { xp: number; at: number }> }

const reward = (id: string, kind: RewardKind, label: string): Reward => ({
  id,
  kind,
  xp: XP_BY_REWARD[kind],
  label
})

export const reviewLabelOf = (review: Pick<GameReview, 'provider' | 'number'>): string =>
  `${review.provider === 'gitlab' ? '!' : '#'}${review.number}`

export const isCiRed = (review: GameReview | null): boolean =>
  review !== null &&
  (review.state === 'open' || review.state === 'draft') &&
  review.ci === 'failure'

// Only a change seen between two polls of the same worktree earns XP, so a restart never re-awards.
export const rewardsOf = (previous: GameState | null, next: GameState): Reward[] => {
  if (previous === null || (previous.worktree?.id ?? '') !== (next.worktree?.id ?? '')) {
    return []
  }
  const out: Reward[] = []
  const before = previous.review
  const after = next.review
  const isSameReview =
    before !== null &&
    after !== null &&
    before.provider === after.provider &&
    before.number === after.number
  if (isSameReview) {
    const key = `${after.provider}${reviewLabelOf(after)}@${next.worktree?.id ?? ''}`
    const text = gameStrings().text
    if (before.state !== 'merged' && after.state === 'merged') {
      out.push(reward(`review-merged:${key}`, 'review-merged', text.merged(reviewLabelOf(after))))
    }
    if (before.ci !== 'success' && after.ci === 'success') {
      out.push(reward(`ci-green:${key}`, 'ci-green', text.ciGreen(reviewLabelOf(after))))
    }
  }
  const was = previous.workItem
  const item = next.workItem
  const isSameItem =
    was !== null &&
    item !== null &&
    was.provider === item.provider &&
    was.identifier === item.identifier &&
    was.statusGroup !== item.statusGroup
  if (isSameItem && (item.statusGroup === 'review' || item.statusGroup === 'done')) {
    const kind = item.statusGroup === 'review' ? 'work-item-review' : 'work-item-done'
    const id = `${kind}:${item.provider}:${item.identifier}`
    out.push(reward(id, kind, `${item.identifier} ${item.status}`))
  }
  return out
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const totalOf = (awards: XpLedger['awards']): number =>
  Object.values(awards).reduce((sum, row) => sum + row.xp, 0)

export const xpLedgerOf = (stored: unknown): XpLedger => {
  const awards: XpLedger['awards'] = {}
  const rows = isRecord(stored) && isRecord(stored.awards) ? stored.awards : {}
  for (const [id, row] of Object.entries(rows)) {
    if (isRecord(row) && typeof row.xp === 'number' && typeof row.at === 'number') {
      awards[id] = { xp: row.xp, at: row.at }
    }
  }
  return { total: totalOf(awards), awards }
}

export const awardXp = (
  ledger: XpLedger,
  rewards: readonly Reward[],
  at: number
): { ledger: XpLedger; awarded: Reward[] } => {
  const awards = { ...ledger.awards }
  const awarded = rewards.filter((one) => awards[one.id] === undefined)
  for (const one of awarded) {
    awards[one.id] = { xp: one.xp, at }
  }
  return { ledger: { total: totalOf(awards), awards }, awarded }
}

export const levelOf = (total: number): Level => {
  let level = 1
  let into = Math.max(0, total)
  let need = 100
  while (into >= need) {
    into -= need
    level += 1
    need = 100 * level
  }
  return { level, into, need }
}
