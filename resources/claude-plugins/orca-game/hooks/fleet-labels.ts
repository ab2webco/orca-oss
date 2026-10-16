import type {
  GameAgentState,
  GameCi,
  GameLink,
  GameLinkKind,
  GameLinkTone,
  GameReview,
  GameState,
  GameWorkItem
} from '../types'
import { cellWidthOf, fitCells } from './cell-width'
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

/** The review's number and state, for a band that shows its CI as a chip of its own. */
export const reviewStateTextOf = (review: GameReview): string =>
  `${reviewLabelOf(review)} ${gameStrings().text.reviewStates[review.state]}`

export const reviewTextOf = (review: GameReview): string =>
  `${reviewStateTextOf(review)} · CI ${gameStrings().text.ciWords[review.ci]}`

const CI_MARKS: Readonly<Record<GameCi, string>> = {
  success: '✓',
  failure: '✗',
  pending: '◷',
  neutral: '·',
  none: ''
}

export const ciShortOf = (ci: GameCi): string => `CI ${CI_MARKS[ci]}`.trim()

const CI_OF_TONE: Readonly<Record<GameLinkTone, GameCi>> = {
  danger: 'failure',
  success: 'success',
  pending: 'pending',
  neutral: 'neutral'
}

const isCi = (status: string | undefined): status is GameCi =>
  status !== undefined && status in CI_MARKS

/** A CI link's status as a CI state, read from its tone when the status is not one. */
export const ciOfLink = (link: GameLink): GameCi =>
  isCi(link.status) ? link.status : CI_OF_TONE[link.tone ?? 'neutral']

export const linkOfKind = (links: readonly GameLink[], kind: GameLinkKind): GameLink | undefined =>
  links.find((link) => link.kind === kind)

export type ActivityLink = {
  id: string
  name: string
  label: string
  url: string
  running: boolean
}

/** Every distinct activity Orca linked, or the calling pane's own when no link carries one. */
export const activityLinksOf = (state: Pick<GameState, 'links' | 'activity'>): ActivityLink[] => {
  const linked = state.links
    .filter((link) => link.kind === 'activity')
    .map((link) => ({
      id: link.id,
      name: link.provider,
      label: link.label,
      url: link.url,
      running: link.status === 'running'
    }))
  const own = state.activity
  return linked.length > 0 || own === null
    ? linked
    : [{ id: 'own', name: own.name, label: own.id, url: own.url, running: own.running }]
}

export const activityTextOf = (one: Pick<ActivityLink, 'name' | 'label' | 'running'>): string =>
  `${one.running ? '▶ ' : ''}${[one.name, one.label].filter((part) => part !== '').join(' ')}`

const PROJECT_SHORT_CELLS = 10

export const projectLabelsOf = (label: string): [string, ...string[]] => {
  const full = `↗ ${label}`
  const short = fitCells(full, PROJECT_SHORT_CELLS)
  return short === full ? [full] : [full, short]
}

/** The review as its number and a CI mark, for a narrow band. */
export const reviewShortOf = (review: GameReview): string =>
  `${reviewLabelOf(review)} ${CI_MARKS[review.ci]}`.trim()

// The status is the tracker's own word, so it stays as Orca sent it.
export const workItemTextOf = (item: GameWorkItem): string =>
  `${item.identifier} ${item.status || item.statusGroup}`

export type NeedPart = { key: string; text: string; url: string | null }

/** The "Needs you" line as parts, a need with a URL its own link, cut to `columns` cells. */
export const needPartsOf = (needs: readonly Need[], columns: number): NeedPart[] => {
  const whole: NeedPart[] = [
    { key: 'need-heading', text: gameStrings().text.needsYou, url: null },
    ...needs.flatMap((need, at) => [
      { key: `need-gap-${at}`, text: at === 0 ? ' ' : ' · ', url: null },
      { key: `need-${at}`, text: `${need.name} ${need.text}`, url: need.url }
    ])
  ]
  const parts: NeedPart[] = []
  let room = columns
  for (const part of whole) {
    const text = fitCells(part.text, room)
    if (text === '') {
      break
    }
    parts.push({ ...part, text })
    room -= cellWidthOf(text)
    if (text !== part.text) {
      break
    }
  }
  return parts
}

export const teammatesOf = (count: number): string => gameStrings().text.teammates(count)
