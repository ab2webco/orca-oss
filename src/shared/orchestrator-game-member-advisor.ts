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

/** One of Jev's latest decisions in a pane: its id, verdict and the gesture the game plays for it. */
export type GameMemberAdvisorDecision = { id: string; verdict: string; gesture: string | null }

/** What a member pane says its Jev has it on, and which dimension Orca pinned at launch. */
export type GameMemberAdvisorReport = GameMemberAdvisorPick &
  GameMemberAdvisorDetail & {
    pinned: { model: boolean; effort: boolean }
    /** Newest last; absent from a mod that sends none, which an older Orca also drops. */
    decisions?: GameMemberAdvisorDecision[]
  }

/** The report the lead's Panel reads, with what the member was on before Jev's latest switch. */
export type GameMemberAdvisor = GameMemberAdvisorReport & { previous?: GameMemberAdvisorPick }

export const GAME_MEMBER_ADVISOR_VERSION = 1
export const GAME_MEMBER_ADVISOR_PANES_MAX = 64
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

export const GAME_MEMBER_ADVISOR_DECISIONS_MAX = 5

/** A pane's decisions as a field to spread; nothing where its Jev sent none, so a card stays as it was. */
export const gameAdvisorDecisionsOf = (
  advisor: GameMemberAdvisorReport | undefined
): { decisions?: GameMemberAdvisorDecision[] } =>
  advisor?.decisions ? { decisions: advisor.decisions } : {}

// Why ids only: a decision's title and tool text are the pane's own, never sent across.
function decisionsOf(value: unknown): GameMemberAdvisorDecision[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.slice(-GAME_MEMBER_ADVISOR_DECISIONS_MAX).flatMap((one) => {
    if (!isRecord(one)) {
      return []
    }
    const id = wordsOf(one.id)
    const verdict = wordsOf(one.verdict)
    const gesture = wordsOf(one.gesture)
    return id && verdict ? [{ id, verdict, gesture: gesture ?? null }] : []
  })
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
    const text = key in value ? wordsOf(value[key], key === 'confidence') : undefined
    if (text !== undefined) {
      detail[key] = text
    }
  }
  const decisions = decisionsOf(value.decisions)
  return {
    model,
    effort,
    pinned: { model: pinned.model === true, effort: pinned.effort === true },
    ...detail,
    ...(decisions ? { decisions } : {})
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
