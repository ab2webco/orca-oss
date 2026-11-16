import {
  STEWARD_EFFORTS,
  STEWARD_PHASES,
  type StewardEffort,
  type StewardPhase,
  type StewardPick,
  type StewardPlanPhase
} from './steward-rules'

// What the steward reads (the lead's plan from the CLI) and keeps (its decisions) (ORCA-1242).
// Why only the last 50 in the plugin store: the durable per-ticket log is Orca's, in PR 3.

export const STEWARD_LOG_MAX = 50
export const STEWARD_SESSIONS_MAX = 20

export type StewardPlanState = 'none-yet' | 'none' | 'plan'

export type StewardDecision = {
  at: number
  moment: 'plan' | 'edit' | 'test-loop' | 'pr-ci' | 'captures' | 'judged' | 'quota' | 'stand-down'
  phase: StewardPhase | null
  from: StewardPick
  to: StewardPick
  applied: boolean
  source: 'plan' | 'default' | 'haiku' | 'router' | 'override' | 'none'
  why: string
  isFloored?: true
  confidence?: number
  failure?: string
  tokens?: { input: number; output: number }
}

/** The why a decision carries when no plan or judgment gives one; the card words it in PR 3. */
export const STEWARD_MOMENT_WHY: Readonly<Record<StewardDecision['moment'], string>> = {
  plan: "the lead's plan for this phase",
  edit: 'editing code, from the next step on',
  'test-loop': 'the same test failed twice',
  'pr-ci': 'watching the PR and CI',
  captures: 'taking or reading captures',
  judged: 'judged by Haiku',
  quota: 'a usage window is past 85 %',
  'stand-down': 'another choice is in force'
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

/** `orca game plan <ticket> --json`'s answer; null when the CLI did not answer one. */
export function stewardPlanOf(
  stdout: string
): { state: 'plan'; phases: StewardPlanPhase[] } | { state: 'none'; phases: null } | null {
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
  return read.length === 0 ? { state: 'none', phases: null } : { state: 'plan', phases: read }
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
