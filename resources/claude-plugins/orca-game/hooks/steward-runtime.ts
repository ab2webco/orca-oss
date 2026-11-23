import type { EngineInterface } from 'claude-code'

import type { AdvisorPins } from './advisor-report'
import { isPaneSession } from './pane-session'
import type { CacheEnv, CacheGate, CacheState } from './steward-cache'
import { CACHE_TRACK_START, type CacheTrack } from './steward-cache-track'
import type { StewardJudgeBudget } from './steward-judge'
import {
  STEWARD_STORE_KEY,
  stewardLogWith,
  stewardSessionsWith,
  type StewardCacheNote,
  type StewardDecision,
  type StewardPlanState,
  type StewardRecord
} from './steward-record'
import {
  STEWARD_HIGH_RISK_PATHS,
  type StewardPhase,
  type StewardPick,
  type StewardPlanPhase,
  type StewardTrack
} from './steward-rules'

// The steward's state for one member session (ORCA-1242) and the log it keeps of its decisions.

export type Runtime = {
  role: 'member' | 'other' | null
  base: StewardPick | null
  pins: AdvisorPins
  pick: StewardPick | null
  track: StewardTrack
  ticket: string | null
  title: string
  plan: StewardPlanPhase[] | null
  riskyPaths: readonly string[]
  planState: StewardPlanState
  planReadAt: number | null
  budget: StewardJudgeBudget
  quota: number
  tools: string[]
  standDown: 'router' | 'override' | null
  /** Why it stands down; opusplan and a fallback report as `override` to an older Orca. */
  standDownWhy: StandDownWhy | null
  stepsSeen: number
  decisions: StewardDecision[]
  cache: CacheTrack
  env: CacheEnv
  /** The `model` setting is opusplan, read once per turn. */
  isOpusplan: boolean
  /** The command line set `--model opusplan`, read once per session. */
  isOpusplanFlag: boolean
  /** The session's model as the engine resolves it, read once per turn. */
  sessionModel: string
  phaseRun: { phase: StewardPhase | null; from: number }
}

export type StandDownWhy = 'router' | 'opusplan' | 'fallback' | 'override'

// Module state: one member session; a hot reload starts it over from the next step.
export const runtime: Runtime = {
  role: null,
  base: null,
  pins: { model: false, effort: false },
  pick: null,
  track: { phase: null, failing: null, hasEdited: false },
  ticket: null,
  title: '',
  plan: null,
  riskyPaths: STEWARD_HIGH_RISK_PATHS,
  planState: 'none-yet',
  planReadAt: null,
  budget: { calls: 0, lastAt: null },
  quota: 0,
  tools: [],
  standDown: null,
  standDownWhy: null,
  stepsSeen: 0,
  decisions: [],
  cache: CACHE_TRACK_START,
  env: { login: 'subscription', ttl: '1h' },
  isOpusplan: false,
  isOpusplanFlag: false,
  sessionModel: '',
  phaseRun: { phase: null, from: 0 }
}

export async function isMember($: EngineInterface): Promise<boolean> {
  if (runtime.role === null) {
    const [role, isOwn] = await Promise.all([
      $.env.get('ORCA_GAME_ROLE').catch(() => undefined),
      isPaneSession($)
    ])
    runtime.role = role === 'member' && isOwn ? 'member' : 'other'
  }
  return runtime.role === 'member'
}

const recordOf = (): StewardRecord => ({
  version: 1,
  phase: runtime.track.phase,
  pick: runtime.pick,
  planState: runtime.planState,
  standDown: runtime.standDown,
  stepsSeen: runtime.stepsSeen,
  decisions: runtime.decisions,
  ticket: runtime.ticket,
  pins: runtime.pins
})

export async function saveRecord($: EngineInterface): Promise<void> {
  const [session, held] = await Promise.all([$.session.id(), $.store.get(STEWARD_STORE_KEY)]).catch(
    () => []
  )
  if (session !== undefined) {
    const sessions = stewardSessionsWith(held, session, recordOf())
    await $.store.set(STEWARD_STORE_KEY, sessions).catch(() => undefined)
  }
}

export async function note($: EngineInterface, entry: Omit<StewardDecision, 'at'>): Promise<void> {
  const at = await $.clock.now()
  runtime.decisions = stewardLogWith(runtime.decisions, { at, ...entry })
  await saveRecord($)
}

export const cacheNoteOf = (state: CacheState, gate: CacheGate): StewardCacheNote => ({
  warm: state.warm,
  known: state.known,
  ttl: state.ttl,
  contextTokens: state.contextTokens,
  why: gate.why,
  extraUsd: gate.cost?.extraUsd ?? null,
  breakEven: gate.cost?.breakEven ?? null
})
