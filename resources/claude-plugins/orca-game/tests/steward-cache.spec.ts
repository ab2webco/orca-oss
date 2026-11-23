import { describe, expect, it } from 'vitest'

import {
  cacheStateOf,
  cacheEnvOf,
  cacheTtlOf,
  isEffortCacheKept,
  modelPriceOf,
  switchCostOf,
  withCache,
  type CacheState
} from '../hooks/steward-cache'

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const MIN = 60_000

describe('modelPriceOf (ORCA-1350)', () => {
  it("prices each model from the pricing page's row", () => {
    expect(modelPriceOf(OPUS, 50_000)).toEqual({ write5m: 5, write1h: 8, read: 0.2, output: 20 })
    expect(modelPriceOf(SONNET, 50_000)).toEqual({
      write5m: 2.5,
      write1h: 4,
      read: 0.1,
      output: 10
    })
    expect(modelPriceOf('claude-fable-5-2', 50_000)).toMatchObject({ read: 0.2, output: 40 })
  })

  it('prices Haiku 5.5 at its higher row once the prompt is over 100k tokens', () => {
    expect(modelPriceOf(HAIKU, 100_000)).toEqual({
      write5m: 0.125,
      write1h: 0.2,
      read: 0.01,
      output: 0.5
    })
    expect(modelPriceOf(HAIKU, 100_001)).toEqual({
      write5m: 0.625,
      write1h: 1,
      read: 0.05,
      output: 2.5
    })
  })

  it('knows no price for a model off the table', () => {
    expect(modelPriceOf('claude-sonnet-9-9', 1)).toBeNull()
  })
})

describe('isEffortCacheKept (ORCA-1350)', () => {
  it('keeps the cache on an effort change on Fable 5.1+, Opus, Sonnet and Haiku 5.5', () => {
    for (const model of [OPUS, SONNET, HAIKU, 'claude-fable-5-1', 'claude-fable-5-2']) {
      expect(isEffortCacheKept(model)).toBe(true)
    }
    for (const model of ['claude-opus-4-8', 'claude-fable-5', 'claude-sonnet-4-6']) {
      expect(isEffortCacheKept(model)).toBe(false)
    }
  })

  it('not on a cloud provider, a gateway or with experimental betas off', () => {
    expect(isEffortCacheKept(OPUS, 'provider')).toBe(false)
    expect(isEffortCacheKept(OPUS, 'api-key')).toBe(true)
  })
})

describe('cacheTtlOf (ORCA-1350)', () => {
  it("reads the TTL from the last write's split, else the login", () => {
    expect(cacheTtlOf({ ephemeral1h: 300, ephemeral5m: 0 }, 'subscription')).toBe('1h')
    expect(cacheTtlOf({ ephemeral1h: 0, ephemeral5m: 300 }, 'subscription')).toBe('5m')
    expect(cacheTtlOf(null, 'subscription')).toBe('1h')
    expect(cacheTtlOf(null, 'api-key')).toBe('5m')
    expect(cacheTtlOf({ ephemeral1h: 0, ephemeral5m: 0 }, 'api-key')).toBe('5m')
    expect(cacheTtlOf(null, 'provider')).toBe('5m')
  })
})

describe('cacheEnvOf (ORCA-1350)', () => {
  it('reads the login and the TTL overrides Claude Code documents, in its order', () => {
    expect(cacheEnvOf({})).toEqual({ login: 'subscription', ttl: '1h' })
    expect(cacheEnvOf({ ANTHROPIC_API_KEY: 'k' })).toEqual({ login: 'api-key', ttl: '5m' })
    expect(cacheEnvOf({ CLAUDE_CODE_USE_BEDROCK: '1' })).toEqual({ login: 'provider', ttl: '5m' })
    expect(cacheEnvOf({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }).login).toBe('provider')
    expect(cacheEnvOf({ ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }).ttl).toBe(
      '1h'
    )
    expect(cacheEnvOf({ ANTHROPIC_API_KEY: 'k', ENABLE_PROMPT_CACHING_1H: '1' }).ttl).toBe('1h')
    expect(
      cacheEnvOf({ CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', FORCE_PROMPT_CACHING_5M: '1' }).ttl
    ).toBe('5m')
    expect(cacheEnvOf({ CLAUDE_CODE_PROMPT_CACHE_TTL: 'soon' }).ttl).toBe('1h')
  })
})

describe('cacheStateOf (ORCA-1350)', () => {
  it("is warm within the TTL of the last request's start and cold after it", () => {
    const last = { model: OPUS, startedAt: 0, contextTokens: 120_000, ttl: '5m' as const }
    expect(cacheStateOf(last, 4 * MIN, '1h')).toMatchObject({ warm: true, known: true, ttl: '5m' })
    expect(cacheStateOf(last, 6 * MIN, '1h')).toMatchObject({ warm: false, known: true })
    expect(cacheStateOf({ ...last, ttl: '1h' }, 59 * MIN, '5m').warm).toBe(true)
  })

  it("assumes warm, on the login's TTL, when it has no request to read", () => {
    expect(cacheStateOf(null, 0, '5m')).toEqual({
      warm: true,
      known: false,
      ttl: '5m',
      contextTokens: 0
    })
  })
})

describe('switchCostOf (ORCA-1350)', () => {
  it('Opus to Sonnet on a warm 5m cache pays back after about 23 turns on context alone', () => {
    const cost = switchCostOf({
      from: OPUS,
      to: SONNET,
      contextTokens: 100_000,
      ttl: '5m',
      warm: true,
      outputTokensPerTurn: 0
    })
    expect(cost.extraUsd).toBeCloseTo(0.23, 5)
    expect(cost.breakEven).toBe(23)
  })

  it('counts output savings and the 1h write price', () => {
    expect(
      switchCostOf({
        from: OPUS,
        to: SONNET,
        contextTokens: 100_000,
        ttl: '5m',
        warm: true,
        outputTokensPerTurn: 2_000
      }).breakEven
    ).toBe(8)
    expect(
      switchCostOf({
        from: OPUS,
        to: SONNET,
        contextTokens: 100_000,
        ttl: '1h',
        warm: true,
        outputTokensPerTurn: 0
      }).breakEven
    ).toBe(38)
  })

  it('a cold cache makes a cheaper model cheaper from its first turn', () => {
    const cost = switchCostOf({
      from: OPUS,
      to: SONNET,
      contextTokens: 100_000,
      ttl: '5m',
      warm: false,
      outputTokensPerTurn: 0
    })
    expect(cost.extraUsd).toBeCloseTo(-0.25, 5)
    expect(cost.breakEven).toBe(0)
  })

  it("prices a move to Haiku over 100k at Haiku's higher row", () => {
    const cost = switchCostOf({
      from: OPUS,
      to: HAIKU,
      contextTokens: 300_000,
      ttl: '5m',
      warm: true,
      outputTokensPerTurn: 0
    })
    expect(cost.extraUsd).toBeCloseTo(0.1275, 5)
    expect(cost.breakEven).toBe(3)
  })

  it('an upward move never pays back, and its miss cost is the whole rewrite', () => {
    const cost = switchCostOf({
      from: SONNET,
      to: OPUS,
      contextTokens: 100_000,
      ttl: '5m',
      warm: true,
      outputTokensPerTurn: 2_000
    })
    expect(cost.extraUsd).toBeCloseTo(0.49, 5)
    expect(cost.breakEven).toBeNull()
  })

  it('an unpriced model has no break-even', () => {
    expect(
      switchCostOf({
        from: OPUS,
        to: 'claude-sonnet-9-9',
        contextTokens: 1_000,
        ttl: '5m',
        warm: true,
        outputTokensPerTurn: 0
      })
    ).toEqual({ extraUsd: null, breakEven: null })
  })
})

const WARM: CacheState = { warm: true, known: true, ttl: '5m', contextTokens: 100_000 }
const COLD: CacheState = { ...WARM, warm: false }
const OPUS_HIGH = { model: OPUS, effort: 'high' } as const
const SONNET_MEDIUM = { model: SONNET, effort: 'medium' } as const
const gate = (over: Partial<Parameters<typeof withCache>[0]>) =>
  withCache({
    current: OPUS_HIGH,
    next: SONNET_MEDIUM,
    cache: WARM,
    quota: 10,
    remainingTurns: 15,
    outputTokensPerTurn: 0,
    login: 'subscription',
    returns: false,
    ...over
  })

describe('withCache (ORCA-1350)', () => {
  it('warm: holds the model, moves the effort, and keeps the switch for later', () => {
    expect(gate({})).toEqual({
      pick: { model: OPUS, effort: 'medium' },
      held: SONNET_MEDIUM,
      why: 'warm-hold',
      cost: { extraUsd: expect.closeTo(0.23, 5), breakEven: 23 }
    })
  })

  it('cold: switches down at once, cheaper from its first turn', () => {
    expect(gate({ cache: COLD })).toMatchObject({ pick: SONNET_MEDIUM, held: null, why: 'cold' })
  })

  it('switches down on a warm cache once the phase outlasts N*', () => {
    expect(gate({ remainingTurns: 40 })).toMatchObject({
      pick: SONNET_MEDIUM,
      held: null,
      why: 'pays-back'
    })
  })

  it('a usage window past 85 % overrides the warm hold', () => {
    expect(gate({ quota: 90 })).toMatchObject({ pick: SONNET_MEDIUM, why: 'quota' })
  })

  it('an unknown cache counts as warm and holds, whatever the phase length', () => {
    const unknown: CacheState = { warm: true, known: false, ttl: '1h', contextTokens: 0 }
    expect(gate({ cache: unknown, remainingTurns: 1_000 })).toMatchObject({
      pick: { model: OPUS, effort: 'medium' },
      why: 'warm-hold'
    })
  })

  it('an upward switch always goes through, with its miss cost', () => {
    expect(gate({ current: SONNET_MEDIUM, next: OPUS_HIGH })).toEqual({
      pick: OPUS_HIGH,
      held: null,
      why: 'upward',
      cost: { extraUsd: expect.closeTo(0.49, 5), breakEven: null }
    })
  })

  it('a move to Haiku over 100k is priced at its higher row', () => {
    const big: CacheState = { ...WARM, contextTokens: 300_000 }
    const haiku = { model: HAIKU, effort: 'low' } as const
    expect(gate({ next: haiku, cache: big, remainingTurns: 3 })).toMatchObject({
      why: 'warm-hold',
      cost: { breakEven: 3 }
    })
    expect(gate({ next: haiku, cache: big, remainingTurns: 4 })).toMatchObject({
      pick: haiku,
      why: 'pays-back'
    })
  })

  it('an effort-only change keeps the cache, so it goes through warm', () => {
    expect(gate({ next: { model: OPUS, effort: 'low' } })).toEqual({
      pick: { model: OPUS, effort: 'low' },
      held: null,
      why: 'effort-only',
      cost: null
    })
  })

  it('on a model whose effort change misses, a warm cache holds the effort too', () => {
    const old = { model: 'claude-opus-4-8', effort: 'high' } as const
    expect(gate({ current: old, next: { ...old, effort: 'low' } })).toMatchObject({
      pick: old,
      held: { ...old, effort: 'low' },
      why: 'warm-hold'
    })
  })

  it('prices the way back up into N* for a phase that hands back to the bigger model', () => {
    expect(gate({ returns: true, remainingTurns: 72 })).toMatchObject({
      why: 'warm-hold',
      cost: { extraUsd: expect.closeTo(0.72, 5), breakEven: 72 }
    })
    expect(gate({ returns: true, remainingTurns: 73 })).toMatchObject({ why: 'pays-back' })
  })

  it('an unread context records no miss cost, not a free one', () => {
    const unknown: CacheState = { warm: true, known: false, ttl: '1h', contextTokens: 0 }
    expect(gate({ cache: unknown, current: SONNET_MEDIUM, next: OPUS_HIGH })).toMatchObject({
      why: 'upward',
      cost: { extraUsd: null, breakEven: null }
    })
  })

  it("on a provider where effort misses, a warm cache holds Opus 5.5's effort too", () => {
    expect(gate({ next: { model: OPUS, effort: 'low' }, login: 'provider' })).toMatchObject({
      pick: OPUS_HIGH,
      why: 'warm-hold'
    })
  })
})
