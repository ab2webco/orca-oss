import {
  cacheStateOf,
  cacheTtlOf,
  type CacheEnv,
  type CacheRequest,
  type CacheState
} from './steward-cache'
import type { StewardPhase, StewardPick } from './steward-rules'

// What the steward has seen of a member's main-loop requests, to price a switch (ORCA-1350).

/** Main-loop requests a phase is expected to take; tune from the logged `phaseTurns`. */
export const STEWARD_PHASE_TURNS: Readonly<Record<StewardPhase, number>> = {
  map: 15,
  design: 15,
  implement: 40,
  'test-fix': 20,
  captures: 10,
  'pr-ci': 20
}
/** Phases that usually hand back to the bigger model, so a switch into them pays the way back too. */
export const STEWARD_RETURNING_PHASES: ReadonlySet<StewardPhase> = new Set([
  'map',
  'captures',
  'pr-ci'
])
// Why 2k: the research's assumption until a step reports its own.
const OUTPUT_TOKENS_DEFAULT = 2_000

export type CacheTrack = {
  last: CacheRequest | null
  asked: { model: string; startedAt: number; turnId: string } | null
  /** Set by the engine's own compaction; a /rewind keeps the cache, so it does not count. */
  isCompacted: boolean
  output: { tokens: number; steps: number }
  /** The turn an automatic fallback answered: the steward leaves the rest of it alone. */
  fallbackTurn: string | null
  /** A switch the warm cache held back, for the next cold step. */
  held: StewardPick | null
}

export const CACHE_TRACK_START: CacheTrack = {
  last: null,
  asked: null,
  isCompacted: false,
  output: { tokens: 0, steps: 0 },
  fallbackTurn: null,
  held: null
}

export const trackStepStart = (
  track: CacheTrack,
  step: { model: string; turnId: string; now: number }
): CacheTrack => ({
  ...track,
  asked: { model: step.model, startedAt: step.now, turnId: step.turnId }
})

const countOf = (usage: object, key: string): number => {
  const value: unknown = Reflect.get(usage, key)
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

const isSameModel = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a)

/** A step's answer; `usage` is read loosely, since an older engine sends none. */
export function trackStepResult(track: CacheTrack, usage: unknown, env: CacheEnv): CacheTrack {
  const asked = track.asked
  if (asked === null || typeof usage !== 'object' || usage === null) {
    return { ...track, asked: null }
  }
  const served: unknown = Reflect.get(usage, 'model')
  const model = typeof served === 'string' && served !== '' ? served : asked.model
  const written = {
    ephemeral1h: countOf(usage, 'ephemeral_1h_input_tokens'),
    ephemeral5m: countOf(usage, 'ephemeral_5m_input_tokens')
  }
  const isWritten = written.ephemeral1h + written.ephemeral5m > 0
  const contextTokens = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
    .map((key) => countOf(usage, key))
    .reduce((sum, one) => sum + one, 0)
  return {
    ...track,
    asked: null,
    isCompacted: false,
    last: {
      model,
      startedAt: asked.startedAt,
      contextTokens,
      ttl: isWritten ? cacheTtlOf(written, env.login) : (track.last?.ttl ?? env.ttl)
    },
    output: {
      tokens: track.output.tokens + countOf(usage, 'output_tokens'),
      steps: track.output.steps + 1
    },
    fallbackTurn: isSameModel(model, asked.model) ? track.fallbackTurn : asked.turnId
  }
}

export function cacheNowOf(track: CacheTrack, now: number, env: CacheEnv): CacheState {
  const state = cacheStateOf(track.last, now, env.ttl)
  return track.isCompacted ? { ...state, warm: false } : state
}

export const outputPerTurnOf = (track: CacheTrack): number =>
  track.output.steps === 0 ? OUTPUT_TOKENS_DEFAULT : track.output.tokens / track.output.steps
