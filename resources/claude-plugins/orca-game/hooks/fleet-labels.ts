import type { GameAgentState, GameCi, GameReview, GameWorkItem } from '../types'
import { gameStrings } from './game-strings'
import type { Need } from './party'
import { reviewLabelOf } from './rewards'

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

export const reviewTextOf = (review: GameReview): string => {
  const { reviewStates, ciWords } = gameStrings().text
  return `${reviewLabelOf(review)} ${reviewStates[review.state]} · CI ${ciWords[review.ci]}`
}

const CI_MARKS: Readonly<Record<GameCi, string>> = {
  success: '✓',
  failure: '✗',
  pending: '◷',
  neutral: '·',
  none: ''
}

/** The review as its number and a CI mark, for a narrow band. */
export const reviewShortOf = (review: GameReview): string =>
  `${reviewLabelOf(review)} ${CI_MARKS[review.ci]}`.trim()

// The status is the tracker's own word, so it stays as Orca sent it.
export const workItemTextOf = (item: GameWorkItem): string =>
  `${item.identifier} ${item.status || item.statusGroup}`

export const needsLineOf = (needs: readonly Need[]): string =>
  `${gameStrings().text.needsYou} ${needs.map((need) => `${need.name} ${need.text}`).join(' · ')}`

export const teammatesOf = (count: number): string => gameStrings().text.teammates(count)
