import type { GameAgent, GameStatusGroup } from './orchestrator-game-state'

/** What a member left behind once the lead freed it: `orca game history`. */

export const GAME_HISTORY_OUTCOMES = ['merged', 'qa', 'stopped', 'failed', 'limited'] as const
export type GameHistoryOutcome = (typeof GAME_HISTORY_OUTCOMES)[number]

export type GameHistoryRecord = {
  ticket: string | null
  /** The repo its worktree belongs to; Orca's host fills it in. */
  repo: string | null
  branch: string | null
  agent: string | null
  account: string | null
  launchedAt: string | null
  endedAt: string
  outcome: GameHistoryOutcome
  /** `#41 merged`, or null without a PR. */
  pr: string | null
  /** The body of its last worker_done or escalation to the lead. */
  lastReport: string | null
}

// Why 200: a few weeks of one project's tickets, small enough to read whole on every call.
export const GAME_HISTORY_MAX = 200
const TEXT_MAX = 200
const REPORT_MAX = 600

/** `T` lets the store keep, as they were, the records a newer build wrote. */
export function appendGameHistory<T = GameHistoryRecord>(
  records: readonly T[],
  record: GameHistoryRecord
): (T | GameHistoryRecord)[] {
  return [...records, record].slice(-GAME_HISTORY_MAX)
}

/** Newest first; `since` is any date `Date.parse` reads, compared with when the member ended. */
export function filterGameHistory(
  records: readonly GameHistoryRecord[],
  filter: { ticket?: string; since?: string }
): GameHistoryRecord[] {
  const ticket = filter.ticket?.trim().toUpperCase()
  const since = filter.since ? Date.parse(filter.since) : Number.NaN
  return records
    .filter((one) => !ticket || one.ticket === ticket)
    .filter((one) => Number.isNaN(since) || Date.parse(one.endedAt) >= since)
    .toReversed()
}

export function gameHistoryOutcomeOf(
  agent: { workItem?: { statusGroup: GameStatusGroup }; limit?: GameAgent['limit'] },
  freedBy: 'sweep' | 'stop',
  workerState?: string
): GameHistoryOutcome {
  if (freedBy === 'sweep') {
    return agent.workItem?.statusGroup === 'review' ? 'qa' : 'merged'
  }
  if (agent.limit) {
    return 'limited'
  }
  return workerState === 'failed' ? 'failed' : 'stopped'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown, max = TEXT_MAX): string | null | undefined => {
  if (value === null || value === undefined) {
    return null
  }
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

/** A record as it arrives over RPC or from disk; null when any field is malformed. */
export function parseGameHistoryRecord(raw: unknown): GameHistoryRecord | null {
  if (!isRecord(raw) || typeof raw.endedAt !== 'string' || Number.isNaN(Date.parse(raw.endedAt))) {
    return null
  }
  const outcome = GAME_HISTORY_OUTCOMES.find((one) => one === raw.outcome)
  const fields = {
    ticket: textOrNull(raw.ticket),
    repo: textOrNull(raw.repo),
    branch: textOrNull(raw.branch),
    agent: textOrNull(raw.agent),
    account: textOrNull(raw.account),
    launchedAt: textOrNull(raw.launchedAt),
    pr: textOrNull(raw.pr),
    lastReport: textOrNull(raw.lastReport, REPORT_MAX)
  }
  if (!outcome || Object.values(fields).some((value) => value === undefined)) {
    return null
  }
  return {
    ticket: fields.ticket ?? null,
    repo: fields.repo ?? null,
    branch: fields.branch ?? null,
    agent: fields.agent ?? null,
    account: fields.account ?? null,
    launchedAt: fields.launchedAt ?? null,
    endedAt: raw.endedAt,
    outcome,
    pr: fields.pr ?? null,
    lastReport: fields.lastReport ?? null
  }
}
