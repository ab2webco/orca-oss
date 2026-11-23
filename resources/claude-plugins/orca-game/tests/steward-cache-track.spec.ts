import { describe, expect, it } from 'vitest'

import type { CacheEnv } from '../hooks/steward-cache'
import {
  CACHE_TRACK_START,
  STEWARD_PHASE_TURNS,
  STEWARD_RETURNING_PHASES,
  cacheNowOf,
  outputPerTurnOf,
  trackStepResult,
  trackStepStart,
  type CacheTrack
} from '../hooks/steward-cache-track'
import { STEWARD_MOMENT_WHY } from '../hooks/steward-record'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const MIN = 60_000
const SUBSCRIPTION: CacheEnv = { login: 'subscription', ttl: '1h' }
const API_KEY: CacheEnv = { login: 'api-key', ttl: '5m' }

const asked = (model = OPUS, turnId = 't1', now = 0): CacheTrack =>
  trackStepStart(CACHE_TRACK_START, { model, turnId, now })

describe('STEWARD_PHASE_TURNS (ORCA-1350)', () => {
  it("holds the lead's table of main-loop requests per phase", () => {
    expect(STEWARD_PHASE_TURNS).toEqual({
      map: 15,
      design: 15,
      implement: 40,
      'test-fix': 20,
      captures: 10,
      'pr-ci': 20
    })
    expect([...STEWARD_RETURNING_PHASES].sort()).toEqual(['captures', 'map', 'pr-ci'])
  })
})

describe('trackStepResult (ORCA-1350)', () => {
  it("records the step's context, its TTL from the write split, and its output", () => {
    const track = trackStepResult(
      asked(OPUS, 't1', 5 * MIN),
      {
        model: OPUS,
        input_tokens: 10,
        cache_read_input_tokens: 80_000,
        cache_creation_input_tokens: 2_000,
        ephemeral_1h_input_tokens: 2_000,
        output_tokens: 1_500
      },
      SUBSCRIPTION
    )
    expect(track.last).toEqual({
      model: OPUS,
      startedAt: 5 * MIN,
      contextTokens: 82_010,
      ttl: '1h'
    })
    expect(track.asked).toBeNull()
    expect(outputPerTurnOf(track)).toBe(1_500)
  })

  it('takes the TTL the write reports, whatever the login', () => {
    const fiveMinute = trackStepResult(asked(), { ephemeral_5m_input_tokens: 100 }, SUBSCRIPTION)
    expect(fiveMinute.last?.ttl).toBe('5m')
    const apiKey = trackStepResult(asked(), { ephemeral_1h_input_tokens: 100 }, API_KEY)
    expect(apiKey.last?.ttl).toBe('1h')
  })

  it("keeps the last TTL when a step writes nothing, and the login's on the first", () => {
    const first = trackStepResult(asked(), { cache_read_input_tokens: 10 }, SUBSCRIPTION)
    expect(first.last?.ttl).toBe('1h')
    const written = trackStepResult(asked(), { ephemeral_5m_input_tokens: 9 }, SUBSCRIPTION)
    const after = trackStepResult(
      trackStepStart(written, { model: OPUS, turnId: 't2', now: MIN }),
      { cache_read_input_tokens: 10 },
      SUBSCRIPTION
    )
    expect(after.last?.ttl).toBe('5m')
  })

  it('marks the turn when another model answered, as an automatic fallback does', () => {
    const fallback = trackStepResult(asked(OPUS, 't7'), { model: SONNET }, SUBSCRIPTION)
    expect(fallback.fallbackTurn).toBe('t7')
    expect(fallback.last?.model).toBe(SONNET)
    const dated = trackStepResult(asked(OPUS), { model: `${OPUS}-20261101` }, SUBSCRIPTION)
    expect(dated.fallbackTurn).toBeNull()
  })

  it('ignores a step with no usage, as an older engine sends, and one never asked', () => {
    const none = trackStepResult(asked(), undefined, SUBSCRIPTION)
    expect(none).toEqual({ ...CACHE_TRACK_START, asked: null })
    expect(trackStepResult(CACHE_TRACK_START, { output_tokens: 5 }, SUBSCRIPTION)).toEqual(
      CACHE_TRACK_START
    )
    const odd = trackStepResult(asked(), { output_tokens: -3, input_tokens: 'x' }, SUBSCRIPTION)
    expect(odd.last?.contextTokens).toBe(0)
    expect(odd.output.tokens).toBe(0)
  })

  it('clears a compaction once a step has written the new history', () => {
    const compacted = { ...asked(), isCompacted: true }
    expect(trackStepResult(compacted, {}, SUBSCRIPTION).isCompacted).toBe(false)
  })
})

describe('cacheNowOf (ORCA-1350)', () => {
  it('is warm within the TTL, cold past it, and cold once compacted', () => {
    const track = trackStepResult(asked(), { ephemeral_5m_input_tokens: 10 }, SUBSCRIPTION)
    expect(cacheNowOf(track, 4 * MIN, SUBSCRIPTION).warm).toBe(true)
    expect(cacheNowOf(track, 6 * MIN, SUBSCRIPTION).warm).toBe(false)
    expect(cacheNowOf({ ...track, isCompacted: true }, MIN, SUBSCRIPTION).warm).toBe(false)
  })

  it('reads an unseen cache as warm, unknown, with the TTL the login gives', () => {
    expect(cacheNowOf(CACHE_TRACK_START, 0, API_KEY)).toEqual({
      warm: true,
      known: false,
      ttl: '5m',
      contextTokens: 0
    })
  })
})

describe('outputPerTurnOf (ORCA-1350)', () => {
  it('assumes 2k output tokens until a step reports its own, then averages', () => {
    expect(outputPerTurnOf(CACHE_TRACK_START)).toBe(2_000)
    const one = trackStepResult(asked(), { output_tokens: 1_000 }, SUBSCRIPTION)
    const two = trackStepResult(
      trackStepStart(one, { model: OPUS, turnId: 't2', now: MIN }),
      { output_tokens: 3_000 },
      SUBSCRIPTION
    )
    expect(outputPerTurnOf(two)).toBe(2_000)
    expect(two.output.steps).toBe(2)
  })
})

describe("the record's cache moments (ORCA-1350)", () => {
  it('says why a held switch lands when the cache goes cold or is compacted', () => {
    expect(STEWARD_MOMENT_WHY.cold).toMatch(/cold/)
    expect(STEWARD_MOMENT_WHY.compacted).toMatch(/compaction/)
  })
})
