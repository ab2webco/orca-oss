import type { CacheGateWhy, CacheTtl } from './steward-cache'
import {
  STEWARD_EFFORTS,
  STEWARD_PHASES,
  type StewardEffort,
  type StewardPhase,
  type StewardPick,
  type StewardMomentReason,
  type StewardPlanPhase
} from './steward-rules'

// What the steward reads (the lead's plan from the CLI) and keeps (its decisions) (ORCA-1242).
// Why only the last 50 in the plugin store: the durable per-ticket log is Orca's, in PR 3.

export const STEWARD_LOG_MAX = 50
export const STEWARD_SESSIONS_MAX = 20
export const STEWARD_STORE_KEY = 'steward'
/** The CLI hands it to `game.state` as `steward`; an older CLI or host ignores it. */
export const STEWARD_REPORT_ENV = 'ORCA_GAME_STEWARD'
// Why 10: a 30 s poll carries every decision since the last one, and main skips those it kept.
const REPORT_DECISIONS = 10

export type StewardPlanState = 'none-yet' | 'none' | 'plan'

/** The member's prompt cache when the steward picked, and what a switch would cost it (ORCA-1350). */
export type StewardCacheNote = {
  warm: boolean
  known: boolean
  ttl: CacheTtl
  contextTokens: number
  why: CacheGateWhy
  extraUsd: number | null
  breakEven: number | null
}

export type StewardDecision = {
  at: number
  moment:
    | StewardMomentReason
    | 'plan'
    | 'announce'
    | 'judged'
    | 'quota'
    | 'stand-down'
    | 'cold'
    | 'compacted'
  phase: StewardPhase | null
  from: StewardPick
  to: StewardPick
  applied: boolean
  source:
    | 'plan'
    | 'default'
    | 'haiku'
    | 'router'
    | 'override'
    | 'opusplan'
    | 'fallback'
    | 'cache'
    | 'none'
  why: string
  isFloored?: true
  confidence?: number
  failure?: string
  tokens?: { input: number; output: number }
  cache?: StewardCacheNote
  /** The phase this decision left, and the main-loop requests it really took. */
  phaseTurns?: { phase: StewardPhase; turns: number }
}

/** The why a decision carries when no plan or judgment gives one; the card words it in PR 3. */
export const STEWARD_MOMENT_WHY: Readonly<Record<StewardDecision['moment'], string>> = {
  plan: "the lead's plan for this phase",
  // Why both: the engine sends a new effort only on a step with input, so it lands on the next turn.
  edit: 'editing code: the model from the next step, the effort from the next turn',
  'high-risk': 'the first edit of a high-risk path',
  announce: "the member announced its plan: the lead's implement phase",
  'test-loop': 'the same test failed twice',
  'pr-ci': 'watching the PR and CI',
  captures: 'taking or reading captures',
  judged: 'judged by Haiku',
  quota: 'a usage window is past 85 %',
  'stand-down': 'another choice is in force',
  cold: 'the cache went cold: the held switch costs nothing more now',
  compacted: 'a compaction rewrote the history: the held switch lands with it'
}

/** What the steward keeps in the plugin store, for the card in PR 3. */
export type StewardRecord = {
  version: 1
  phase: StewardPhase | null
  pick: StewardPick | null
  planState: StewardPlanState
  standDown: 'router' | 'override' | null
  stepsSeen: number
  decisions: StewardDecision[]
  /** Absent from a record an older mod stored. */
  ticket?: string | null
  pins?: { model: boolean; effort: boolean }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const planPhaseOf = (value: unknown): StewardPlanPhase | null => {
  if (!isRecord(value)) {
    return null
  }
  const { phase, model, effort, why } = value
  return STEWARD_PHASES.includes(phase as StewardPhase) &&
    typeof model === 'string' &&
    STEWARD_EFFORTS.includes(effort as StewardEffort) &&
    typeof why === 'string'
    ? { phase: phase as StewardPhase, model, effort: effort as StewardEffort, why }
    : null
}

export type StewardPlanRead = (
  | { state: 'plan'; phases: StewardPlanPhase[] }
  | { state: 'none'; phases: null }
) & { highRiskPaths: string[] }

/** `orca game plan <ticket> --json`'s answer; null when the CLI did not answer one. */
export function stewardPlanOf(stdout: string): StewardPlanRead | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  const result = isRecord(raw) && raw.ok === true && isRecord(raw.result) ? raw.result : null
  if (result === null) {
    return null
  }
  const phases =
    isRecord(result.plan) && Array.isArray(result.plan.phases) ? result.plan.phases : []
  const read = phases.flatMap((one) => planPhaseOf(one) ?? [])
  // Why optional: an older Orca answers no paths, and the built-in list still applies.
  const paths = Array.isArray(result.highRiskPaths) ? result.highRiskPaths : []
  const highRiskPaths = paths.filter((one): one is string => typeof one === 'string').slice(0, 50)
  return read.length === 0
    ? { state: 'none', phases: null, highRiskPaths }
    : { state: 'plan', phases: read, highRiskPaths }
}

export const stewardLogWith = (
  log: readonly StewardDecision[],
  entry: StewardDecision
): StewardDecision[] => [...log, entry].slice(-STEWARD_LOG_MAX)

/** The store's records by session: each member pane keeps its own, the oldest sessions go first. */
export function stewardSessionsWith(
  held: unknown,
  session: string,
  record: StewardRecord
): Record<string, StewardRecord> {
  const sessions: Record<string, unknown> = isRecord(held) ? { ...held } : {}
  delete sessions[session]
  const kept = Object.entries(sessions).slice(1 - STEWARD_SESSIONS_MAX)
  return Object.fromEntries([...kept, [session, record]]) as Record<string, StewardRecord>
}

/** This session's record as Orca reads it on the state poll; null where the steward kept none. */
export function stewardReportOf(held: unknown, session: string): string | null {
  const record = isRecord(held) ? held[session] : undefined
  if (!isRecord(record) || record.version !== 1 || !Array.isArray(record.decisions)) {
    return null
  }
  const kept = record as StewardRecord
  return JSON.stringify({
    version: 1,
    session,
    ticket: kept.ticket ?? null,
    model: kept.pick?.model ?? null,
    effort: kept.pick?.effort ?? null,
    phase: kept.phase,
    plan: kept.planState,
    standDown: kept.standDown,
    pinned: kept.pins ?? { model: false, effort: false },
    stepsSeen: kept.stepsSeen,
    decisions: kept.decisions.slice(-REPORT_DECISIONS)
  })
}
