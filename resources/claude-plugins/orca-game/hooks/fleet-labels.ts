import type {
  GameAgent,
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
import type { CardState } from './lead-state'
import { NAMED_TICKET } from './member-character'
import { agentTagOf } from './member-tags'
import type { Need } from './party'
import { reviewLabelOf } from './rewards'

export const CI_COLORS: Readonly<Record<GameCi, string>> = {
  success: 'green',
  failure: 'red',
  pending: 'yellow',
  neutral: 'gray',
  none: 'gray'
}

export const AGENT_COLORS: Readonly<Record<CardState, string>> = {
  working: 'cyan',
  orchestrating: 'cyan',
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

export type MemberHeading = { name: string; title: string }

const TICKET = NAMED_TICKET
// Orca's own fixed-length cut of a long task name.
const ORCA_CUT = '...'

/** A member's ticket id, with its character, apart from its title; the work item's title is whole, the name's may be cut. */
export const memberHeadingOf = (
  agent: Pick<GameAgent, 'displayName' | 'workItem'>
): MemberHeading => {
  const match = TICKET.exec(agent.displayName)
  const ticket = agent.workItem?.identifier ?? match?.[2]
  const character = match?.[1]
  const name =
    ticket === undefined ? agent.displayName : character ? `${character} · ${ticket}` : ticket
  if (agent.workItem !== undefined && agent.workItem.title !== '') {
    return { name, title: agent.workItem.title }
  }
  const rest = match?.[3] ?? ''
  if (!rest.endsWith(ORCA_CUT)) {
    return { name, title: rest }
  }
  const words = rest.slice(0, -ORCA_CUT.length).trimEnd().split(' ')
  return { name, title: `${(words.length > 1 ? words.slice(0, -1) : words).join(' ')}…` }
}

/** The text cut at its last word that fits with an ellipsis; mid-word only when one word overflows. */
export const fitWords = (text: string, room: number): string => {
  if (cellWidthOf(text) <= room) {
    return text
  }
  const words = text.split(' ')
  let kept = ''
  for (const word of words) {
    const next = kept === '' ? word : `${kept} ${word}`
    if (cellWidthOf(next) + 1 > room) {
      break
    }
    kept = next
  }
  return kept === '' ? fitCells(text, room) : `${kept}…`
}

const BRANCH_MARK = '⎇ '

/** The branch without `refs/heads/`, its start cut so the name's end stays. */
export const branchLabelOf = (branch: string, room: number): string => {
  const whole = `${BRANCH_MARK}${branch.replace(/^refs\/heads\//, '')}`
  if (cellWidthOf(whole) <= room) {
    return whole
  }
  const glyphs = Array.from(whole.slice(BRANCH_MARK.length))
  let tail = ''
  for (let at = glyphs.length - 1; at >= 0; at -= 1) {
    const next = `${glyphs[at]}${tail}`
    if (cellWidthOf(`${BRANCH_MARK}…${next}`) > room) {
      break
    }
    tail = next
  }
  return tail === '' ? fitCells(whole, room) : `${BRANCH_MARK}…${tail}`
}

/** A card's first row: the state is never cut, the name gives way to it. */
// Why lineRoom: a state that wraps to its own row still breaks mid-word when it outgrows the whole line.
export const memberHeadOf = (
  name: string,
  state: string,
  room: number,
  lineRoom = Infinity
): { name: string; state: string } => ({
  name: fitCells(name, room - cellWidthOf(state) - 1),
  state: cellWidthOf(state) > lineRoom ? fitCells(state, lineRoom) : state
})

const META_GAP = ' · '
// Why 8: a branch keeps at least `⎇ …/604` beside the agent tag.
const BRANCH_MIN_CELLS = 8

/** `claude · ana@… · ⎇ feat/x`: the tag shortens before the branch loses its minimum. */
export const memberMetaOf = (
  agent: Pick<GameAgent, 'agentType' | 'account' | 'worktree' | 'remote'>,
  room: number
): string => {
  const branch = agent.worktree?.branch || agent.worktree?.displayName || ''
  if (branch === '') {
    return fitCells(agentTagOf(agent, room), room)
  }
  const tag = agentTagOf(agent, room - META_GAP.length - BRANCH_MIN_CELLS)
  const left = room - cellWidthOf(tag) - META_GAP.length
  return left <= 0 ? fitCells(tag, room) : `${tag}${META_GAP}${branchLabelOf(branch, left)}`
}
