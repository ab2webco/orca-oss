import type { RecentReward } from '../types'
import type { Reward } from './rewards'

/** The `$.store` key of the latest rewards, which the XP ledger keeps no labels for. */
export const RECENT_KEY = 'recent-rewards'
export const RECENT_MAX = 3

const isRecent = (value: unknown): value is RecentReward =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'label') === 'string' &&
  typeof Reflect.get(value, 'xp') === 'number' &&
  typeof Reflect.get(value, 'at') === 'number'

export const recentRewardsOf = (stored: unknown): RecentReward[] =>
  Array.isArray(stored)
    ? stored.filter(isRecent).map(({ label, xp, at }) => ({ label, xp, at }))
    : []

/** The rewards just awarded, the last one first, ahead of the ones kept. */
export const withRecent = (
  recent: readonly RecentReward[],
  awarded: readonly Reward[],
  at: number
): RecentReward[] =>
  [...awarded.map(({ label, xp }) => ({ label, xp, at })).toReversed(), ...recent].slice(
    0,
    RECENT_MAX
  )
