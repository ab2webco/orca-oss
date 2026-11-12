import { stripTerminalControl } from './terminal-control-stripping'

/** A model and effort as Jev names them; null where Jev set none. */
export type GameMemberAdvisorPick = { model: string | null; effort: string | null }

// Why optional: a newer Jev adds these; a version 1 report without them stays valid.
export const GAME_MEMBER_ADVISOR_DETAIL_KEYS = [
  'line',
  'skill',
  'tool',
  'hold',
  'confidence',
  'routedModel',
  'sessionModel'
] as const

export type GameMemberAdvisorDetailKey = (typeof GAME_MEMBER_ADVISOR_DETAIL_KEYS)[number]

export type GameMemberAdvisorDetail = Partial<Record<GameMemberAdvisorDetailKey, string | null>>

/** What a member pane says its Jev has it on, and which dimension Orca pinned at launch. */
export type GameMemberAdvisorReport = GameMemberAdvisorPick &
  GameMemberAdvisorDetail & {
    pinned: { model: boolean; effort: boolean }
  }

/** The report the lead's Panel reads, with what the member was on before Jev's latest switch. */
export type GameMemberAdvisor = GameMemberAdvisorReport & { previous?: GameMemberAdvisorPick }

export const GAME_MEMBER_ADVISOR_VERSION = 1
export const GAME_MEMBER_ADVISOR_PANES_MAX = 64
const WORDS_MAX = 64
// Why longer: Jev's line is a sentence (model, effort and why), not a name, and the card shows it whole.
const LINE_MAX = 240

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Why a number only for effort: Jev's effort may be a level number, its model never is.
const wordsOf = (
  value: unknown,
  isNumberOk = false,
  max = WORDS_MAX
): string | null | undefined => {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string' && !(isNumberOk && typeof value === 'number')) {
    return undefined
  }
  const words = stripTerminalControl(String(value)).replace(/\s+/g, ' ').trim()
  return words === '' ? null : words.slice(0, max)
}

/** Null when Jev stopped publishing; undefined for a value this build cannot read, which is ignored. */
export function parseGameMemberAdvisorReport(
  value: unknown
): GameMemberAdvisorReport | null | undefined {
  if (value === null) {
    return null
  }
  if (!isRecord(value) || value.version !== GAME_MEMBER_ADVISOR_VERSION) {
    return undefined
  }
  const model = wordsOf(value.model)
  const effort = wordsOf(value.effort, true)
  if (model === undefined || effort === undefined) {
    return undefined
  }
  const pinned = isRecord(value.pinned) ? value.pinned : {}
  const detail: GameMemberAdvisorDetail = {}
  for (const key of GAME_MEMBER_ADVISOR_DETAIL_KEYS) {
    const text =
      key in value
        ? wordsOf(value[key], key === 'confidence', key === 'line' ? LINE_MAX : WORDS_MAX)
        : undefined
    if (text !== undefined) {
      detail[key] = text
    }
  }
  return {
    model,
    effort,
    pinned: { model: pinned.model === true, effort: pinned.effort === true },
    ...detail
  }
}

/** An advisor a host hands back; null for a shape this build cannot read, as a host may run another. */
export function parseGameMemberAdvisor(value: unknown): GameMemberAdvisor | null {
  if (!isRecord(value)) {
    return null
  }
  const report = parseGameMemberAdvisorReport({ ...value, version: GAME_MEMBER_ADVISOR_VERSION })
  if (!report) {
    return null
  }
  const previous = isRecord(value.previous) ? value.previous : {}
  const model = wordsOf(previous.model)
  const effort = wordsOf(previous.effort, true)
  return model === undefined || effort === undefined
    ? report
    : { ...report, previous: { model, effort } }
}
