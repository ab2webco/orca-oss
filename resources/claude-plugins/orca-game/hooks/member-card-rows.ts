import type { GameCi, GameReview, GameWorkItem } from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import { fitWords, reviewTextOf, workItemTextOf } from './fleet-labels'
import { gameStrings } from './game-strings'
import type { CardState } from './lead-state'

const CARD_GLYPHS: Readonly<Record<CardState, string>> = {
  working: '●',
  orchestrating: '●',
  idle: '○',
  done: '✓',
  waiting: '▲'
}
const CI_GLYPHS: Readonly<Record<GameCi, string>> = {
  success: '✓',
  failure: '✗',
  pending: '◐',
  neutral: '·',
  none: '·'
}
const META_GAP = ' · '
// A title cut beside the ticket needs this much room, or it reads as a stub and takes its own row.
const TITLE_BESIDE_MIN_CELLS = 32

export type CardHead = {
  name: string
  title: string
  titleBelow: string
  pill: string
  isAlert: boolean
}

/** Row one of a card: ticket, crown and title, the status pill last; a title that does not fit moves down. */
export function cardHeadOf(parts: {
  name: string
  title: string
  cardState: CardState
  crown: string
  room: number
}): CardHead {
  // Why strip `!`: the pill's ▲ already marks a member waiting on you.
  const label = gameStrings().text.agentStates[parts.cardState].replace(/^!\s*/, '')
  const pill = ` ${CARD_GLYPHS[parts.cardState]} ${label} `
  const crownCells = parts.crown === '' ? 0 : cellWidthOf(parts.crown) + 1
  const nameRoom = Math.max(1, parts.room - cellWidthOf(pill) - 1 - crownCells)
  const name = fitCells(parts.name, nameRoom)
  const titleRoom = nameRoom - cellWidthOf(name) - 2
  const isBeside =
    parts.title !== '' &&
    (cellWidthOf(parts.title) <= titleRoom || titleRoom >= TITLE_BESIDE_MIN_CELLS)
  return {
    name,
    title: isBeside ? fitWords(parts.title, titleRoom) : '',
    titleBelow: isBeside || parts.title === '' ? '' : fitWords(parts.title, parts.room),
    pill,
    isAlert: parts.cardState === 'waiting'
  }
}

/** The dim meta line, with what the member is doing joined to it when the two fit as one. */
export function cardMetaRowsOf(meta: string, doing: string, room: number): string[] {
  if (doing === '') {
    return [meta]
  }
  const joined = `${meta}${META_GAP}${doing}`
  return cellWidthOf(joined) <= room ? [joined] : [meta, fitCells(doing, room)]
}

/** The review (its CI glyph first) and the ticket as padded chips, each cut to the card's width. */
export function cardChipsOf(parts: {
  review?: GameReview
  workItem?: GameWorkItem
  room: number
}): { key: 'review' | 'work-item'; text: string }[] {
  const chipOf = (label: string) => ` ${fitCells(label, Math.max(1, parts.room - 2))} `
  return [
    ...(parts.review === undefined
      ? []
      : [
          {
            key: 'review' as const,
            text: chipOf(`${CI_GLYPHS[parts.review.ci]} ${reviewTextOf(parts.review)}`)
          }
        ]),
    ...(parts.workItem === undefined
      ? []
      : [{ key: 'work-item' as const, text: chipOf(workItemTextOf(parts.workItem)) }])
  ]
}
