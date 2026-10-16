import type { GameAgentState, GameCi, GameLocale, GameReview, LocalizedName } from '../types'
import type { TodoHeading } from './todo-sections'
import { ES } from './locales/es'
import { JA } from './locales/ja'
import { KO } from './locales/ko'
import { ZH } from './locales/zh'

// Orca hands the session its UI language as ORCA_GAME_LOCALE; the mod ships the same five.
export const GAME_LOCALES = ['en', 'es', 'ja', 'ko', 'zh'] as const satisfies readonly GameLocale[]
export type { GameLocale, LocalizedName }

/** Words drawn as terminal text, where any character renders. */
export type TextStrings = {
  panel: string
  refresh: string
  petClawd: string
  close: string
  view: string
  fleet: string
  team: string
  loading: string
  refreshing: string
  unavailable: string
  lead: string
  reviewHeading: string
  workItemHeading: string
  needsYou: string
  waitingNeed: string
  ciFailingNeed: string
  teammates: (count: number) => string
  working: (count: number) => string
  idle: (count: number) => string
  done: (count: number) => string
  waiting: (count: number) => string
  agentStates: Readonly<Record<GameAgentState, string>>
  reviewStates: Readonly<Record<GameReview['state'], string>>
  ciWords: Readonly<Record<GameCi, string>>
  couldNotOpen: (name: string) => string
  openHeading: string
  couldNotOpenLink: (label: string) => string
  merged: (review: string) => string
  ciGreen: (review: string) => string
  questDescription: string
  questModesHelp: string
  questShown: (mode: string) => string
  questDemo: string
  unknownMode: (asked: string) => string
  moreAllies: (count: number) => string
  /** `kind` is PR or MR, after the project's host. */
  myReviews: (kind: string, count: number) => string
  todo: (count: number) => string
  actionsHeading: string
  /** Toast once a prompt is queued for the lead's next turn. */
  sentToLead: (label: string) => string
  couldNotSend: (label: string) => string
  actionRunning: string
  /** Toast for an action pressed during /quest demo, which runs nothing. */
  demoAction: (label: string) => string
  todoHeadings: Readonly<Record<TodoHeading, string>>
  qa: (count: number) => string
  workOn: (id: string) => string
  /** Orca's own lead buttons, by the id after `lead:`. */
  leadActions: Readonly<Record<LeadActionKey, string>>
  /** What the typeahead shows for an action's slash command. */
  actionCommandDescription: (label: string) => string
  actionCommandRefused: (command: string) => string
  actionCommandGone: (command: string) => string
}

export type LeadActionKey = 'wave' | 'status' | 'push' | 'sweep' | 'stop'

/** Words painted into a Raster, which only takes width-1 characters. */
export type ArtStrings = {
  needsYou: string
  alert: (name: string) => string
  ciIsRed: string
  noParty: string
  teammatesJoin: string
  level: string
  xp: string
  thinking: string
  thanks: string
  onIt: string
  levelUp: string
  reading: string
  editing: string
  writing: string
  runningCommand: string
  searchingCode: string
  delegating: (what: string) => string
  anAgent: string
  researchingWeb: string
  running: (what: string) => string
  aSkill: string
  using: (what: string) => string
  says: Readonly<Record<GameAgentState, string>>
  movingTo: (item: string, status: string) => string
}

export type GameStrings = { text: TextStrings; art: ArtStrings }

/** A language's entries; one it leaves out reads in English. */
export type GameCatalog = { text?: Partial<TextStrings>; art?: Partial<ArtStrings> }

const EN: GameStrings = {
  text: {
    panel: 'Panel',
    refresh: 'Refresh',
    petClawd: 'Pet Clawd',
    close: 'Close',
    view: 'View',
    fleet: 'Fleet',
    team: 'Team',
    loading: 'loading…',
    refreshing: '(refreshing)',
    unavailable: 'orca game state unavailable',
    lead: 'lead',
    reviewHeading: 'Review',
    workItemHeading: 'Work item',
    needsYou: 'Needs you:',
    waitingNeed: 'waiting on you',
    ciFailingNeed: 'CI failing',
    teammates: (count) => `Team ${count} teammate${count === 1 ? '' : 's'}`,
    working: (count) => `${count} working`,
    idle: (count) => `${count} idle`,
    done: (count) => `${count} done`,
    waiting: (count) => `${count} waiting on you`,
    agentStates: { working: 'working', idle: 'idle', done: 'done', waiting: '! waiting' },
    reviewStates: { open: 'open', draft: 'draft', merged: 'merged', closed: 'closed' },
    ciWords: {
      success: 'green',
      failure: 'failing',
      pending: 'running',
      neutral: 'neutral',
      none: 'none'
    },
    couldNotOpen: (name) => `Could not open ${name}'s pane`,
    openHeading: 'Open',
    couldNotOpenLink: (label) => `Could not open ${label}`,
    merged: (review) => `${review} merged`,
    ciGreen: (review) => `${review} CI is green`,
    questDescription:
      'Quest mode: an animated Claude, character cards per flow phase, quiet tool rows',
    questModesHelp:
      '/quest off shows everything, /quest on hides tool rows, /quest zen also hides working notes, /quest demo plays a scripted fake party.',
    questShown: (mode) => `Quest: ${mode}.`,
    questDemo:
      'Quest: demo. A scripted fake party plays every reaction; nothing is read or written. /quest on returns to real data.',
    unknownMode: (asked) =>
      `Unknown mode "${asked}". Use /quest off, /quest on, /quest zen or /quest demo.`,
    moreAllies: (count) => `+${count} more`,
    myReviews: (kind, count) => `My ${kind}s ${count}`,
    todo: (count) => `To Do ${count}`,
    actionsHeading: 'Actions',
    sentToLead: (label) => `Sent to the lead: ${label}`,
    couldNotSend: (label) => `Could not send ${label}`,
    actionRunning: 'running…',
    demoAction: (label) => `Demo: ${label} is not run`,
    todoHeadings: {
      in_progress: 'In progress',
      review: 'QA / review',
      todo: 'To do',
      backlog: 'Backlog',
      other: 'Other'
    },
    qa: (count) => `QA ${count}`,
    workOn: (id) => `Work on ${id}`,
    leadActions: { wave: 'Wave', status: 'Status', push: 'Push', sweep: 'Sweep', stop: 'Stop' },
    actionCommandDescription: (label) => `Orca action: ${label}`,
    actionCommandRefused: (command) =>
      `/${command} is taken by another command; use its button in the band or the Panel`,
    actionCommandGone: (command) => `/${command} is no longer one of this project's actions`
  },
  art: {
    needsYou: 'needs you!',
    alert: (name) => `${name} needs you!`,
    ciIsRed: 'CI is red',
    noParty: 'No party yet.',
    teammatesJoin: 'Teammates join when the lead spawns them.',
    level: 'Lv',
    xp: 'XP',
    thinking: 'thinking',
    thanks: '♥ thanks!',
    onIt: 'on it!',
    levelUp: '★ level up!',
    reading: 'Reading',
    editing: 'Editing',
    writing: 'Writing',
    runningCommand: 'Running a command',
    searchingCode: 'Searching the code',
    delegating: (what) => `Delegating: ${what}`,
    anAgent: 'an agent',
    researchingWeb: 'Researching the web',
    running: (what) => `Running ${what}`,
    aSkill: 'a skill',
    using: (what) => `Using ${what}`,
    says: { working: 'working', idle: 'idle', done: 'done', waiting: 'waiting' },
    movingTo: (item, status) => `Moving ${item} to ${status}`
  }
}

export const CATALOGS: Readonly<Record<GameLocale, GameCatalog>> = {
  en: EN,
  es: ES,
  ja: JA,
  ko: KO,
  zh: ZH
}

export const gameLocaleOf = (value: string | null | undefined): GameLocale => {
  const said = value?.trim().toLowerCase()
  return GAME_LOCALES.find((one) => one === said) ?? 'en'
}

export const stringsOf = (locale: GameLocale): GameStrings => {
  const catalog = CATALOGS[locale]
  return { text: { ...EN.text, ...catalog.text }, art: { ...EN.art, ...catalog.art } }
}

// Why these ranges: Latin with accents, punctuation, box drawing and blocks, ★ and card suits.
const isRasterCode = (code: number): boolean =>
  (code >= 0x20 && code < 0x7f) ||
  (code >= 0xa0 && code < 0x300) ||
  (code >= 0x2010 && code <= 0x2027) ||
  (code >= 0x2500 && code <= 0x25ff) ||
  code === 0x2605 ||
  (code >= 0x2660 && code <= 0x2667)

export const isRasterText = (text: string): boolean =>
  [...text].every((one) => isRasterCode(one.codePointAt(0) ?? 0))

let activeLocale: GameLocale = 'en'
let active: GameStrings = EN

// Set once per session from ORCA_GAME_LOCALE, before anything is drawn.
export const setGameLocale = (locale: GameLocale): void => {
  activeLocale = locale
  active = stringsOf(locale)
}

export const gameStrings = (): GameStrings => active

export const localizedNameOf = (name: LocalizedName, locale = activeLocale): string =>
  typeof name === 'string' ? name : (name[locale] ?? name.en)
