import { QUOTA_NEAR, isSamePick, modelRankOf, type StewardPick } from './steward-rules'

// What a model switch costs a member's prompt cache (ORCA-1350). Pure, so specs pin the arithmetic.

export type CacheTtl = '5m' | '1h'
/** `provider`: Bedrock, Vertex or experimental betas off, where effort and 1h are not kept. */
export type CacheLogin = 'subscription' | 'api-key' | 'provider'
/** The login, and the TTL a write gets before any write says so. */
export type CacheEnv = { login: CacheLogin; ttl: CacheTtl }

/** USD per million tokens. */
export type ModelPrice = { write5m: number; write1h: number; read: number; output: number }

type PriceRow = { id: RegExp; price: ModelPrice; over100k?: ModelPrice }

// Why these rows: platform.claude.com/docs/en/about-claude/pricing, read 2026-11-22.
const PRICES: readonly PriceRow[] = [
  { id: /^claude-fable-5-2\b/, price: { write5m: 10, write1h: 16, read: 0.2, output: 40 } },
  { id: /^claude-fable-5-1\b/, price: { write5m: 12.5, write1h: 20, read: 0.25, output: 50 } },
  { id: /^claude-opus-5-5\b/, price: { write5m: 5, write1h: 8, read: 0.2, output: 20 } },
  { id: /^claude-sonnet-5-5\b/, price: { write5m: 2.5, write1h: 4, read: 0.1, output: 10 } },
  {
    id: /^claude-haiku-5-5\b/,
    price: { write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
    over100k: { write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 }
  }
]
const HAIKU_LONG_PROMPT = 100_000

// Why: Claude Code keeps the cache on an effort change only on these (prompt-caching docs; ORCA-1350 data).
const EFFORT_KEEPS_CACHE = /^claude-(?:opus-5-5|sonnet-5-5|haiku-5-5|fable-5-[1-9])\b/

/** The row a request of `promptTokens` pays; Haiku 5.5 counts cache reads and writes in it. */
export function modelPriceOf(model: string, promptTokens: number): ModelPrice | null {
  const row = PRICES.find((one) => one.id.test(model))
  if (row === undefined) {
    return null
  }
  return row.over100k !== undefined && promptTokens > HAIKU_LONG_PROMPT ? row.over100k : row.price
}

export const isEffortCacheKept = (model: string, login: CacheLogin = 'subscription'): boolean =>
  login !== 'provider' && EFFORT_KEEPS_CACHE.test(model)

/** The TTL the last write named, else the login's: a subscription within plan gets 1h. */
export function cacheTtlOf(
  written: { ephemeral1h: number; ephemeral5m: number } | null,
  login: CacheLogin
): CacheTtl {
  if (written !== null && written.ephemeral1h > 0) {
    return '1h'
  }
  if (written !== null && written.ephemeral5m > 0) {
    return '5m'
  }
  return login === 'subscription' ? '1h' : '5m'
}

const isOn = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== '0'
const PROVIDER_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'
]

/** The login and TTL overrides, in the order code.claude.com/docs/en/prompt-caching gives them. */
export function cacheEnvOf(env: Readonly<Record<string, string | undefined>>): CacheEnv {
  const login: CacheLogin = PROVIDER_ENV.some((key) => isOn(env[key]))
    ? 'provider'
    : isOn(env.ANTHROPIC_API_KEY)
      ? 'api-key'
      : 'subscription'
  const asked = env.CLAUDE_CODE_PROMPT_CACHE_TTL
  const ttl: CacheTtl = isOn(env.FORCE_PROMPT_CACHING_5M)
    ? '5m'
    : asked === '5m' || asked === '1h'
      ? asked
      : isOn(env.ENABLE_PROMPT_CACHING_1H)
        ? '1h'
        : cacheTtlOf(null, login)
  return { login, ttl }
}

const TTL_MS: Readonly<Record<CacheTtl, number>> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

/** The last main request the steward saw: when it started, its whole prompt and its TTL. */
export type CacheRequest = {
  model: string
  startedAt: number
  contextTokens: number
  ttl: CacheTtl
}

export type CacheState = {
  warm: boolean
  /** False when no request was read: then it counts as warm, the costly side. */
  known: boolean
  ttl: CacheTtl
  contextTokens: number
}

export function cacheStateOf(
  last: CacheRequest | null,
  now: number,
  loginTtl: CacheTtl
): CacheState {
  if (last === null) {
    return { warm: true, known: false, ttl: loginTtl, contextTokens: 0 }
  }
  return {
    warm: now - last.startedAt < TTL_MS[last.ttl],
    known: true,
    ttl: last.ttl,
    contextTokens: last.contextTokens
  }
}

export type SwitchCost = {
  /** One-time extra over staying, in USD; negative when the switch is cheaper at once. */
  extraUsd: number | null
  /** Turns after which the switch pays back; null when it never does (upward) or is unpriced. */
  breakEven: number | null
}

const writeOf = (price: ModelPrice, ttl: CacheTtl): number =>
  ttl === '1h' ? price.write1h : price.write5m

/**
 * Warm: the switch rewrites the history on `to` instead of reading it on `from`. Cold: both
 * rewrite, so only the write prices differ. N* = extra / saving per later turn.
 */
export function switchCostOf(input: {
  from: string
  to: string
  contextTokens: number
  ttl: CacheTtl
  warm: boolean
  outputTokensPerTurn: number
  /** The phase hands back to `from`, which then rewrites the history once more. */
  returns?: boolean
}): SwitchCost {
  const from = modelPriceOf(input.from, input.contextTokens)
  const to = modelPriceOf(input.to, input.contextTokens)
  if (from === null || to === null) {
    return { extraUsd: null, breakEven: null }
  }
  const context = input.contextTokens / 1_000_000
  const output = input.outputTokensPerTurn / 1_000_000
  const stay = input.warm ? from.read : writeOf(from, input.ttl)
  const back = input.returns === true ? context * (writeOf(from, input.ttl) - to.read) : 0
  const extraUsd = context * (writeOf(to, input.ttl) - stay) + back
  const saving = context * (from.read - to.read) + output * (from.output - to.output)
  if (extraUsd <= 0) {
    return { extraUsd, breakEven: saving > 0 ? 0 : null }
  }
  // Why the epsilon: 0.38 / 0.01 lands a hair over 38 in floating point.
  return { extraUsd, breakEven: saving > 0 ? Math.ceil(extraUsd / saving - 1e-9) : null }
}

export type CacheGateWhy = 'effort-only' | 'warm-hold' | 'cold' | 'quota' | 'pays-back' | 'upward'

export type CacheGate = {
  pick: StewardPick
  /** The pick a warm cache held back; the next cold step or compaction applies it. */
  held: StewardPick | null
  why: CacheGateWhy
  cost: SwitchCost | null
}

/**
 * Warm: effort moves, the model stays unless quota or the phase outlasting N* pays for the
 * rewrite. Cold, or a move up for capability or risk: the switch goes through.
 */
export function withCache(input: {
  current: StewardPick
  next: StewardPick
  cache: CacheState
  quota: number
  remainingTurns: number
  outputTokensPerTurn: number
  login: CacheLogin
  returns: boolean
}): CacheGate {
  const { current, next, cache } = input
  const isQuota = input.quota >= QUOTA_NEAR
  const hold = (cost: SwitchCost | null): CacheGate => ({
    pick: {
      model: current.model,
      effort: next.model === current.model ? current.effort : next.effort
    },
    held: next,
    why: 'warm-hold',
    cost
  })
  if (next.model === current.model) {
    const isFree = isSamePick(current, next) || isEffortCacheKept(next.model, input.login)
    return isFree || !cache.warm || isQuota
      ? {
          pick: next,
          held: null,
          why: isFree ? 'effort-only' : cache.warm ? 'quota' : 'cold',
          cost: null
        }
      : hold(null)
  }
  // Why null when unread: a zero context would log the rewrite as free.
  const cost: SwitchCost = cache.known
    ? switchCostOf({
        from: current.model,
        to: next.model,
        contextTokens: cache.contextTokens,
        ttl: cache.ttl,
        warm: cache.warm,
        outputTokensPerTurn: input.outputTokensPerTurn,
        returns: input.returns
      })
    : { extraUsd: null, breakEven: null }
  if (modelRankOf(next.model) > modelRankOf(current.model)) {
    return { pick: next, held: null, why: 'upward', cost }
  }
  if (!cache.warm) {
    return { pick: next, held: null, why: 'cold', cost }
  }
  if (isQuota) {
    return { pick: next, held: null, why: 'quota', cost }
  }
  const paysBack = cost.breakEven !== null && input.remainingTurns > cost.breakEven
  return paysBack ? { pick: next, held: null, why: 'pays-back', cost } : hold(cost)
}
