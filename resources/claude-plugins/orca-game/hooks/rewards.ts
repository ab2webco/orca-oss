import type { GameReview, GameState, RewardKind, RewardWeights } from '../types'
import type { Level } from './fleet-hud'
import { gameStrings } from './game-strings'

export type { RewardKind }

export const XP_BY_REWARD: Readonly<Record<RewardKind, number>> = {
  'review-merged': 100,
  'ci-green': 20,
  'work-item-review': 50,
  'work-item-done': 70,
  'member-claimed': 10,
  'perfect-merge': 100
}

/** `review` is the `#N` label of the review a reward is for, which a merge floats. */
export type Reward = { id: string; kind: RewardKind; xp: number; label: string; review?: string }

export type XpLedger = { total: number; awards: Record<string, { xp: number; at: number }> }

export const reward = (
  id: string,
  kind: RewardKind,
  label: string,
  weights: RewardWeights = XP_BY_REWARD
): Reward => ({ id, kind, xp: weights[kind] ?? XP_BY_REWARD[kind], label })

const REWARD_WEIGHT_MAX = 1000

const isWeight = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= REWARD_WEIGHT_MAX

/** The weights `game state` hands over, read like the host validates them; none from an older host. */
export const rewardWeightsOf = (value: unknown): { rewardWeights?: RewardWeights } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const known = Object.keys(XP_BY_REWARD) as RewardKind[]
  const entries = known.flatMap((kind) => {
    const weight: unknown = Reflect.get(value, kind)
    return isWeight(weight) ? [[kind, weight] as const] : []
  })
  return { rewardWeights: Object.fromEntries(entries) }
}

export const signedXpOf = (xp: number): string => (xp < 0 ? `${xp}` : `+${xp}`)

export const reviewLabelOf = (review: Pick<GameReview, 'provider' | 'number'>): string =>
  `${review.provider === 'gitlab' ? '!' : '#'}${review.number}`

export const isCiRed = (review: GameReview | null): boolean =>
  review !== null &&
  (review.state === 'open' || review.state === 'draft') &&
  review.ci === 'failure'

type Work = Pick<GameState, 'review' | 'workItem'>

/** A worktree's review and ticket moving on; the ids are the same from any pane that sees it. */
export const workRewardsOf = (
  previous: Work,
  next: Work,
  worktreeId: string,
  weights: RewardWeights = XP_BY_REWARD
): Reward[] => {
  const out: Reward[] = []
  const before = previous.review
  const after = next.review
  const isSameReview =
    before !== null &&
    after !== null &&
    before.provider === after.provider &&
    before.number === after.number
  if (isSameReview) {
    const label = reviewLabelOf(after)
    const key = `${after.provider}${label}@${worktreeId}`
    const text = gameStrings().text
    if (before.state !== 'merged' && after.state === 'merged') {
      out.push({
        ...reward(`review-merged:${key}`, 'review-merged', text.merged(label), weights),
        review: label
      })
    }
    if (before.perfectMerge !== true && after.perfectMerge === true) {
      out.push({
        ...reward(`perfect-merge:${key}`, 'perfect-merge', text.perfectMerge(label), weights),
        review: label
      })
    }
    if (before.ci !== 'success' && after.ci === 'success') {
      out.push({
        ...reward(`ci-green:${key}`, 'ci-green', text.ciGreen(label), weights),
        review: label
      })
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
    out.push(reward(id, kind, `${item.identifier} ${item.status}`, weights))
  }
  return out
}

// Only a change seen between two polls of the same worktree earns XP, so a restart never re-awards.
export const rewardsOf = (
  previous: GameState | null,
  next: GameState,
  weights: RewardWeights = XP_BY_REWARD
): Reward[] =>
  previous === null || (previous.worktree?.id ?? '') !== (next.worktree?.id ?? '')
    ? []
    : workRewardsOf(previous, next, next.worktree?.id ?? '', weights)

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
