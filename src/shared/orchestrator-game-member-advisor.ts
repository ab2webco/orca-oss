import { stripTerminalControl } from './terminal-control-stripping'

/** A model and effort as Jev names them; null where Jev set none. */
export type GameMemberAdvisorPick = { model: string | null; effort: string | null }

/** What a member pane says its Jev has it on, and which dimension Orca pinned at launch. */
export type GameMemberAdvisorReport = GameMemberAdvisorPick & {
  pinned: { model: boolean; effort: boolean }
}

/** The report the lead's Panel reads, with what the member was on before Jev's latest switch. */
export type GameMemberAdvisor = GameMemberAdvisorReport & { previous?: GameMemberAdvisorPick }

const GAME_MEMBER_ADVISOR_VERSION = 1
const WORDS_MAX = 64

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Why a number only for effort: Jev's effort may be a level number, its model never is.
const wordsOf = (value: unknown, isNumberOk = false): string | null | undefined => {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string' && !(isNumberOk && typeof value === 'number')) {
    return undefined
  }
  const words = stripTerminalControl(String(value)).replace(/\s+/g, ' ').trim()
  return words === '' ? null : words.slice(0, WORDS_MAX)
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
  return {
    model,
    effort,
    pinned: { model: pinned.model === true, effort: pinned.effort === true }
  }
}
