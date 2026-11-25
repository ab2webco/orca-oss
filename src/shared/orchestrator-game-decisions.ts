/** `orca game decision`: the project's decision trail and follow-ups, kept by the runtime, not a lead's chat (ORCA-1428). */

/** A follow-up stays pending until `game decision done`; a plain decision has none. */
export type GameFollowUp = { doneAt: string | null }

export type GameDecision = {
  id: string
  at: string
  ticket: string | null
  decision: string
  why: string | null
  /** A link or one line: the PR, comment or run the decision rests on. */
  evidence: string | null
  followUp: GameFollowUp | null
}

/** What the lead records; the trail stamps id and time. */
export type GameDecisionDraft = {
  ticket?: string
  decision: string
  why?: string
  evidence?: string
  followUp?: boolean
}

export type GameDecisionList = {
  /** Pending follow-ups, oldest first, never cut. */
  followUps: GameDecision[]
  /** Decisions and done follow-ups, newest first; the last 20 unless `all`. */
  decisions: GameDecision[]
  /** Rows behind `decisions` before the cut. */
  total: number
}

export const GAME_DECISION_TEXT_MAX = 2000
export const GAME_DECISION_EVIDENCE_MAX = 500
// Why 500: pending follow-ups are never dropped; this bounds the settled trail a file keeps.
export const GAME_DECISIONS_MAX = 500
const RECENT_MAX = 20

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown): string | null | undefined =>
  value === null || value === undefined ? null : typeof value === 'string' ? value : undefined

function followUpOf(value: unknown): GameFollowUp | null | undefined {
  if (value === null || value === undefined) {
    return null
  }
  const doneAt = isRecord(value) ? textOrNull(value.doneAt) : undefined
  return doneAt === undefined ? undefined : { doneAt }
}

export function parseGameDecision(raw: unknown): GameDecision | null {
  if (!isRecord(raw)) {
    return null
  }
  const { id, at, decision } = raw
  const ticket = textOrNull(raw.ticket)
  const why = textOrNull(raw.why)
  const evidence = textOrNull(raw.evidence)
  const followUp = followUpOf(raw.followUp)
  if (
    typeof id !== 'string' ||
    typeof at !== 'string' ||
    typeof decision !== 'string' ||
    ticket === undefined ||
    why === undefined ||
    evidence === undefined ||
    followUp === undefined
  ) {
    return null
  }
  return { id, at, ticket, decision, why, evidence, followUp }
}

const isPending = (raw: unknown): boolean => {
  const one = parseGameDecision(raw)
  return one?.followUp?.doneAt === null
}

export function gameDecisionOf(
  draft: GameDecisionDraft,
  stamp: { id: string; at: string }
): GameDecision {
  const clean = (value: string | undefined): string | null => value?.trim() || null
  return {
    ...stamp,
    ticket: clean(draft.ticket)?.toUpperCase() ?? null,
    decision: draft.decision.trim(),
    why: clean(draft.why),
    evidence: clean(draft.evidence),
    followUp: draft.followUp ? { doneAt: null } : null
  }
}

/** Appends the row; past the cap the oldest settled rows go, a pending follow-up never. */
export function addGameDecision(list: readonly unknown[], row: GameDecision): unknown[] {
  const next = [...list, row]
  let over = next.length - GAME_DECISIONS_MAX
  return over <= 0 ? next : next.filter((one) => isPending(one) || over-- <= 0)
}

export type GameFollowUpDone =
  | { kind: 'done'; list: unknown[]; decision: GameDecision }
  | { kind: 'repeated'; decision: GameDecision }
  | { kind: 'not_follow_up' }
  | { kind: 'not_found' }

export function settleGameFollowUp(
  list: readonly unknown[],
  id: string,
  at: string
): GameFollowUpDone {
  const index = list.findIndex((one) => parseGameDecision(one)?.id === id)
  const found = index === -1 ? null : parseGameDecision(list[index])
  if (!found) {
    return { kind: 'not_found' }
  }
  if (!found.followUp) {
    return { kind: 'not_follow_up' }
  }
  if (found.followUp.doneAt !== null) {
    return { kind: 'repeated', decision: found }
  }
  const decision = { ...found, followUp: { doneAt: at } }
  return { kind: 'done', list: list.map((one, i) => (i === index ? decision : one)), decision }
}

export function gameDecisionListOf(
  list: readonly unknown[],
  options: { ticket?: string; all?: boolean } = {}
): GameDecisionList {
  const ticket = options.ticket?.trim().toUpperCase()
  const rows = list
    .flatMap((one) => parseGameDecision(one) ?? [])
    .filter((one) => !ticket || one.ticket === ticket)
  const followUps = rows.filter((one) => one.followUp?.doneAt === null)
  const settled = rows.filter((one) => one.followUp?.doneAt !== null).toReversed()
  return {
    followUps,
    decisions: options.all ? settled : settled.slice(0, RECENT_MAX),
    total: settled.length
  }
}
