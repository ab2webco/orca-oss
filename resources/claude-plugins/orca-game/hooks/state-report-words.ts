import type { GameCi, GameLocale, GameReview } from '../types'
import { stringsOf } from './game-strings'
import { ES_STATE_REPORT } from './locales/es-state-report'

/** A member as the lead's fleet sees it, the way `orca game fleet` names the phases. */
export type MemberPhase = 'needs-you' | 'limited' | 'working' | 'idle' | 'finished'

/** The words of `/orca-game:state`'s report. */
export type StateReportWords = {
  title: string
  mode: string
  scene: string
  render: string
  timezone: string
  lead: string
  warnings: string
  links: string
  /** The layer a value came from, as `orca game state` names it. */
  from: (source: string) => string
  sceneFile: (path: string) => string
  /** `command` is the game command that set it for this session. */
  thisSession: (value: string, command: string) => string
  hud: (on: boolean) => string
  rewards: (on: boolean) => string
  tracker: (on: boolean) => string
  leadsHere: (label: string | undefined) => string
  memberHere: (label: string | undefined) => string
  slots: (used: number, cap: number) => string
  noMembers: string
  phases: Readonly<Record<MemberPhase, string>>
  stop: (since: string | null, by: string | null) => string
  stopUnreadable: string
  reviewStates: Readonly<Record<GameReview['state'], string>>
  ciWords: Readonly<Record<GameCi, string>>
  notGamePane: string
  notState: string
  failed: (reason: string) => string
}

export type StateReportCatalog = Omit<StateReportWords, 'reviewStates' | 'ciWords'>

const onOff = (on: boolean): string => (on ? 'on' : 'off')

export const EN_STATE_REPORT: StateReportCatalog = {
  title: 'Agent Teams game',
  mode: 'Mode',
  scene: 'Scene',
  render: 'Render',
  timezone: 'Timezone',
  lead: 'Lead',
  warnings: 'Warnings',
  links: 'Links',
  from: (source) => `(from ${source})`,
  sceneFile: (path) => `scene file ${path}`,
  thisSession: (value, command) => `this session: ${value} (/${command})`,
  hud: (on) => `HUD ${onOff(on)}`,
  rewards: (on) => `rewards ${onOff(on)}`,
  tracker: (on) => `tracker ${onOff(on)}`,
  leadsHere: (label) => (label ? `${label}, this pane` : 'this pane'),
  memberHere: (label) =>
    label
      ? `${label} · this pane is a member and reports to it`
      : 'this pane is a member and reports to its lead',
  slots: (used, cap) => `${used} of ${cap} slots used, ${Math.max(0, cap - used)} free`,
  noMembers: 'no members yet',
  phases: {
    'needs-you': 'needs you',
    limited: 'limited',
    working: 'working',
    idle: 'idle',
    finished: 'finished'
  },
  stop: (since, by) =>
    `STOP${since ? ` since ${since}` : ''}${by ? ` (by ${by})` : ''}: nothing is launched or pushed until \`game resume\``,
  stopUnreadable: 'STOP (its state cannot be read, so it counts as set)',
  notGamePane:
    "This session was not started by Orca's game: ORCA_GAME_CLI is not set, so there is no game state to show. Open a Claude Agent Teams pane from Orca.",
  notState: 'orca game state answered something that is not a game state',
  failed: (reason) => `orca game state failed: ${reason}`
}

export const stateReportWordsOf = (locale: GameLocale): StateReportWords => {
  const { reviewStates, ciWords } = stringsOf(locale).text
  const catalog = locale === 'es' ? ES_STATE_REPORT : EN_STATE_REPORT
  return { ...catalog, reviewStates, ciWords }
}
