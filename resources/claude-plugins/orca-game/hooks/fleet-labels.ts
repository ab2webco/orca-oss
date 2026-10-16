import type { GameAgentState, GameCi, GameReview, GameWorkItem } from '../types'
import type { Need } from './party'
import { reviewLabelOf } from './rewards'

const CI_WORDS: Readonly<Record<GameCi, string>> = {
  success: 'green',
  failure: 'failing',
  pending: 'running',
  neutral: 'neutral',
  none: 'none'
}

export const CI_COLORS: Readonly<Record<GameCi, string>> = {
  success: 'green',
  failure: 'red',
  pending: 'yellow',
  neutral: 'gray',
  none: 'gray'
}

export const AGENT_COLORS: Readonly<Record<GameAgentState, string>> = {
  working: 'cyan',
  idle: 'gray',
  waiting: 'red',
  done: 'green'
}

export const reviewTextOf = (review: GameReview): string =>
  `${reviewLabelOf(review)} ${review.state} · CI ${CI_WORDS[review.ci]}`

export const workItemTextOf = (item: GameWorkItem): string =>
  `${item.identifier} ${item.status || item.statusGroup}`

export const needsLineOf = (needs: readonly Need[]): string =>
  `Needs you: ${needs.map((need) => `${need.name} ${need.text}`).join(' · ')}`

export const teammatesOf = (count: number): string =>
  `Team ${count} teammate${count === 1 ? '' : 's'}`
