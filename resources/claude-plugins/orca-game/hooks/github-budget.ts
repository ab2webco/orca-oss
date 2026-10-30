import type { GameLocale, GameState } from '../types'
import { isShape, type Shape } from './game-state-shapes'
import { gameLocale } from './game-strings'

type Bucket = { remaining: number; limit: number }

const LOW_WORDS: Readonly<Record<GameLocale, (left: number) => string>> = {
  en: (left) => `GitHub API low · ${left} left`,
  es: (left) => `API de GitHub baja · quedan ${left}`
}

/** The band's warning while the account's GitHub budget is low, in the pane's language. */
export const githubLowTextOf = (left: number): string => LOW_WORDS[gameLocale()](left)

const bucketOf = (value: unknown): Bucket[] =>
  isShape(value) &&
  typeof value.remaining === 'number' &&
  typeof value.limit === 'number' &&
  value.limit > 0
    ? [{ remaining: value.remaining, limit: value.limit }]
    : []

/** The bucket nearest its limit, only while Orca reports the GitHub budget low (ORCA-877). */
export const githubLowOf = (body: Shape): Pick<GameState, 'githubLow'> => {
  // Why: the mod reads its stored state back through the same parser, which has no `githubBudget`.
  const stored = bucketOf(body.githubLow)[0]
  if (stored !== undefined) {
    return { githubLow: stored }
  }
  const budget = body.githubBudget
  if (!isShape(budget) || budget.low !== true) {
    return {}
  }
  const lowest = [...bucketOf(budget.graphql), ...bucketOf(budget.core)].sort(
    (a, b) => a.remaining / a.limit - b.remaining / b.limit
  )[0]
  return lowest === undefined ? {} : { githubLow: lowest }
}
