import type { GameAgent, GameReview, GameState, RecentReward } from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import { characterColorOf } from './character-look'
import { xpTextOf, type Level } from './fleet-hud'
import { CI_COLORS, ciShortOf } from './fleet-labels'
import { gameLocale, gameStrings, localizedNameOf } from './game-strings'
import { shortMemberNameOf } from './member-character'
import { memberOf } from './party'
import { isCiRed, reviewLabelOf, signedXpOf } from './rewards'
import type { SceneDefinition, ScenePhase } from './scenes/index'
import { memberPhaseOf, ticketOf } from './state-report'
import { stateReportWordsOf, type MemberPhase, type StateReportWords } from './state-report-words'

/** A run of text in one color; no color reads in the scene's parchment. */
export type FlatPart = { key: string; text: string; color?: string; bold?: boolean }

/** One terminal line of the flat view; a member's line carries its pane key for its View button. */
export type FlatLine = { key: string; parts: readonly FlatPart[]; paneKey?: string }

type Slot = Omit<FlatPart, 'text'> & {
  /** Given up whole before any other slot shortens. */
  isOptional?: boolean
  priority: number
  labels: readonly [string, ...string[]]
}

const GAP = '  '
const SEP = ' · '
const NAME_CELLS = 12
const LOOK_SWATCH = '■'
const LOOK_CELLS = 2
// A character before its ticket, also when Orca sent no title after it.
const CHARACTER = /^(.+?) · /

const PHASE_COLORS: Readonly<Record<Exclude<MemberPhase, 'working'>, string>> = {
  'needs-you': 'red',
  limited: 'yellow',
  idle: 'gray',
  finished: 'green'
}

export const flatTextOf = (line: FlatLine): string => line.parts.map((one) => one.text).join('')

// Parts in order until the room runs out; the part that overflows ends cut with an ellipsis.
const cutParts = (parts: readonly FlatPart[], columns: number): FlatPart[] => {
  const kept: FlatPart[] = []
  let room = columns
  for (const part of parts) {
    const text = fitCells(part.text, room)
    if (text === '') {
      break
    }
    kept.push({ ...part, text })
    room -= cellWidthOf(text)
    if (text !== part.text) {
      break
    }
  }
  return kept
}

// The least important slot, the later one among equals; the first slot is never dropped.
const leastOf = (indexes: readonly number[], slots: readonly Slot[]): number | undefined =>
  indexes.reduce<number | undefined>(
    (worst, at) =>
      worst === undefined || (slots[at]?.priority ?? 0) >= (slots[worst]?.priority ?? 0)
        ? at
        : worst,
    undefined
  )

/** Slots on one line: shorter labels first, then the least important dropped, never wrapped. */
const fitSlots = (slots: readonly Slot[], columns: number): FlatPart[] => {
  const steps = slots.map(() => 0)
  let kept = slots.map((_, at) => at)
  const labelOf = (at: number) => slots[at]?.labels[steps[at] ?? 0] ?? ''
  const widthOf = () =>
    kept.reduce((sum, at, i) => sum + cellWidthOf(labelOf(at)) + (i === 0 ? 0 : GAP.length), 0)
  for (const at of kept.filter((one) => slots[one]?.isOptional === true).toReversed()) {
    if (widthOf() <= columns) {
      break
    }
    kept = kept.filter((one) => one !== at)
  }
  while (widthOf() > columns) {
    const at = leastOf(
      kept.filter((one) => (steps[one] ?? 0) < (slots[one]?.labels.length ?? 1) - 1),
      slots
    )
    if (at === undefined) {
      break
    }
    steps[at] = (steps[at] ?? 0) + 1
  }
  while (widthOf() > columns && kept.length > 1) {
    const at = leastOf(kept.slice(1), slots)
    kept = kept.filter((one) => one !== at)
  }
  const parts = kept.flatMap((at, i): FlatPart[] => {
    const slot = slots[at]
    if (slot === undefined) {
      return []
    }
    const { key, color, bold } = slot
    const part: FlatPart = { key, text: labelOf(at), color, bold }
    return i === 0 ? [part] : [{ key: `${key}-gap`, text: GAP }, part]
  })
  return cutParts(parts, columns)
}

/** The character a member was named after, else its whole name. */
export const flatNameOf = (agent: Pick<GameAgent, 'displayName'>): string =>
  CHARACTER.exec(agent.displayName)?.[1] ?? shortMemberNameOf(agent.displayName)

const markOf = (agent: GameAgent, phase: MemberPhase): [string, string | undefined] => {
  if (agent.isLeader) {
    return ['♛', undefined]
  }
  if (phase === 'needs-you' || isCiRed(agent.review ?? null)) {
    return [phase === 'needs-you' ? '!' : '×', 'red']
  }
  if (phase === 'finished' || agent.state === 'done') {
    return ['✓', 'green']
  }
  if (phase === 'limited') {
    return ['~', 'yellow']
  }
  return phase === 'working' ? ['•', 'cyan'] : ['z', 'gray']
}

const reviewSlotsOf = (review: GameReview | null, words: StateReportWords): Slot[] => {
  if (review === null) {
    return []
  }
  const kind = review.provider === 'gitlab' ? 'MR' : 'PR'
  const id = reviewLabelOf(review)
  const slots: Slot[] = [
    {
      key: 'review',
      priority: 3,
      labels: [`${kind} ${id} ${words.reviewStates[review.state]}`, id]
    }
  ]
  if (review.ci !== 'none') {
    slots.push({
      key: 'ci',
      priority: 3,
      labels: [`CI ${words.ciWords[review.ci]}`, ciShortOf(review.ci)],
      color: CI_COLORS[review.ci]
    })
  }
  return slots
}

const memberLineOf = (
  agent: GameAgent,
  state: GameState,
  scene: SceneDefinition,
  columns: number
): FlatLine => {
  const words = stateReportWordsOf(gameLocale())
  const phase = memberPhaseOf(agent)
  const [mark, color] = markOf(agent, phase)
  const name = flatNameOf(agent)
  const ticket = ticketOf(agent)
  const slots: Slot[] = [
    {
      key: 'name',
      priority: 0,
      labels: [`${mark} ${name}`, `${mark} ${fitCells(name, NAME_CELLS)}`],
      color: color ?? scene.band.gold,
      bold: true
    }
  ]
  if (ticket !== agent.displayName && ticket !== name) {
    slots.push({ key: 'ticket', priority: 2, labels: [ticket] })
  }
  if (phase === 'working') {
    const member = memberOf(agent, state, true)
    const card = scene.cards[member.phase]
    const label = `${card.icon} ${localizedNameOf(card.name)}`
    slots.push({ key: 'phase', priority: 1, labels: [label, card.icon], color: card.color })
    // What the HUD's bubble says; the first word a narrow line gives up.
    slots.push({ key: 'says', priority: 4, labels: [member.says], color: 'gray', isOptional: true })
  } else {
    const bold = phase === 'needs-you'
    const label = words.phases[phase]
    slots.push({ key: 'phase', priority: 1, labels: [label], color: PHASE_COLORS[phase], bold })
  }
  slots.push(...reviewSlotsOf(agent.review ?? null, words))
  // Why a swatch, not the name's color: the name's color already says the member's state.
  const look = characterColorOf(scene, agent.displayName)
  const swatch: FlatPart[] =
    look === undefined
      ? []
      : [{ key: 'look', text: `${LOOK_SWATCH} `, color: `#${look.toString(16).padStart(6, '0')}` }]
  return {
    key: `flat-member-${agent.paneKey}`,
    parts: [...swatch, ...fitSlots(slots, columns - swatch.length * LOOK_CELLS)],
    paneKey: agent.paneKey
  }
}

export type FlatMembersInput = {
  state: GameState
  scene: SceneDefinition
  columns: number
  /** Lines the team may take, the `+N` line included. */
  maxMembers: number
}

/** One line per teammate, the lead first; past `maxMembers` a `+N` line counts the rest. */
export const flatMemberLinesOf = ({
  state,
  scene,
  columns,
  maxMembers
}: FlatMembersInput): FlatLine[] => {
  const agents = [
    ...state.agents.filter((one) => one.isLeader),
    ...state.agents.filter((one) => !one.isLeader)
  ]
  if (agents.length === 0) {
    const empty = fitCells(gameStrings().art.noParty, columns)
    return [{ key: 'flat-empty', parts: [{ key: 'empty', text: empty, color: 'gray' }] }]
  }
  const cap = Math.max(1, maxMembers)
  const shown = agents.length > cap ? agents.slice(0, cap - 1) : agents
  const lines = shown.map((agent) => memberLineOf(agent, state, scene, columns))
  const hidden = agents.length - shown.length
  if (hidden === 0) {
    return lines
  }
  const more = fitCells(gameStrings().text.moreAllies(hidden), columns)
  return [...lines, { key: 'flat-more', parts: [{ key: 'more', text: more, color: 'gray' }] }]
}

export type FlatScoreInput = {
  level: Level | undefined
  recent: readonly RecentReward[]
  isDemo: boolean
  columns: number
}

/** Level, XP and the latest rewards on one line; nothing while rewards are off. */
export const flatScoreLineOf = ({
  level,
  recent,
  isDemo,
  columns
}: FlatScoreInput): FlatLine | undefined => {
  if (level === undefined && !isDemo) {
    return undefined
  }
  const parts: FlatPart[] = [
    ...(isDemo ? [{ key: 'demo', text: 'DEMO', color: 'yellow', bold: true }] : []),
    ...(level === undefined ? [] : [{ key: 'xp', text: xpTextOf(level), bold: true }]),
    ...recent.map((one, at) => ({
      key: `reward-${at}`,
      text: `${signedXpOf(one.xp)} ${one.label}`,
      color: one.xp < 0 ? 'red' : 'green'
    }))
  ]
  const spaced = parts.flatMap((part, at) =>
    at === 0 ? [part] : [{ key: `${part.key}-sep`, text: SEP, color: 'gray' }, part]
  )
  return { key: 'flat-score', parts: cutParts(spaced, columns) }
}

/** What the scene's hero would show: the phase's card and the caption, in the card's color. */
export const flatPhaseLineOf = (
  scene: SceneDefinition,
  phase: ScenePhase | undefined,
  caption: string,
  columns: number
): FlatLine => {
  const card = scene.cards[phase ?? 'working']
  const parts: FlatPart[] = [
    {
      key: 'card',
      text: `${card.icon} ${localizedNameOf(card.name)}`,
      color: card.color,
      bold: true
    },
    ...(caption === '' ? [] : [{ key: 'caption', text: `${SEP}${caption}` }])
  ]
  return { key: 'flat-phase', parts: cutParts(parts, columns) }
}

/** A member pane's own line: its character, ticket, the phase it shows, its PR and CI. */
export const memberSelfLineOf = (
  state: GameState | null,
  scene: SceneDefinition,
  phase: ScenePhase | undefined,
  columns: number
): FlatLine => {
  const words = stateReportWordsOf(gameLocale())
  // Why the leader row: Orca marks the pane that asked for the state as its leader.
  const self = state?.agents.find((one) => one.isLeader) ?? state?.agents[0]
  const slots: Slot[] = []
  const name = self === undefined ? undefined : flatNameOf(self)
  if (name !== undefined) {
    const short = fitCells(name, NAME_CELLS)
    const gold = scene.band.gold
    slots.push({ key: 'name', priority: 0, labels: [name, short], color: gold, bold: true })
  }
  const ticket = state?.workItem?.identifier ?? (self === undefined ? undefined : ticketOf(self))
  if (ticket !== undefined && ticket !== name && ticket !== self?.displayName) {
    slots.push({ key: 'ticket', priority: 2, labels: [ticket] })
  }
  const card = scene.cards[phase ?? 'working']
  slots.push({
    key: 'phase',
    priority: 1,
    labels: [`${card.icon} ${localizedNameOf(card.name)}`, card.icon],
    color: card.color
  })
  slots.push(...reviewSlotsOf(state?.review ?? null, words))
  if (state === null) {
    slots.push({ key: 'loading', priority: 4, labels: [gameStrings().text.loading], color: 'gray' })
  }
  return { key: 'band-member-self', parts: fitSlots(slots, columns) }
}
