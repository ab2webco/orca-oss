import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parsePlaneRateLimitHeaders,
  parsePlaneRetryAfterMs,
  PLANE_RATE_LIMIT_DEFAULT_MAX_REQUESTS,
  PLANE_RATE_LIMIT_WINDOW_MS,
  PlaneRateLimiter
} from './plane-rate-limiter'

describe('PlaneRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes the documented 60 requests / 60s defaults', () => {
    expect(PLANE_RATE_LIMIT_DEFAULT_MAX_REQUESTS).toBe(60)
    expect(PLANE_RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })

  it('allows N requests within the window then blocks the N+1 until capacity frees', async () => {
    const limiter = new PlaneRateLimiter(2, 1_000)

    await limiter.acquire('workspace-a')
    await limiter.acquire('workspace-a')

    let resolved = false
    const pending = limiter.acquire('workspace-a').then(() => {
      resolved = true
    })

    // Why: flush microtasks without advancing time — the 3rd slot must still be blocked.
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(resolved).toBe(true)
  })

  it('tracks separate windows per key so one workspace cannot starve another', async () => {
    const limiter = new PlaneRateLimiter(1, 1_000)

    await limiter.acquire('workspace-a')

    let resolved = false
    limiter.acquire('workspace-b').then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(true)
  })

  it('frees capacity once the sliding window elapses', async () => {
    const limiter = new PlaneRateLimiter(1, 1_000)

    await limiter.acquire('workspace-a')
    await vi.advanceTimersByTimeAsync(999)

    let resolved = false
    const pending = limiter.acquire('workspace-a').then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(2)
    await pending
    expect(resolved).toBe(true)
  })
})

// ORCA-1166: a fixed 60/min starved the Tasks page behind agents' calls on a server allowing 300.
describe('PlaneRateLimiter budget from the server', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const settled = async (promise: Promise<void>): Promise<boolean> => {
    let done = false
    void promise.then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    return done
  }

  it("sizes the window from the server's remaining count", async () => {
    const limiter = new PlaneRateLimiter(2, 1_000)
    await limiter.acquire('a')
    await limiter.acquire('a')
    limiter.observe('a', { remaining: 8, resetAtMs: Date.now() + 1_000 })
    expect(await settled(limiter.acquire('a'))).toBe(true)
  })

  it('keeps the fallback budget when the server sends no headers', async () => {
    const limiter = new PlaneRateLimiter(2, 1_000)
    await limiter.acquire('a')
    await limiter.acquire('a')
    limiter.observe('a', null)
    expect(await settled(limiter.acquire('a'))).toBe(false)
  })

  it('waits when the server says nothing is left, even under the fallback budget', async () => {
    const limiter = new PlaneRateLimiter(10, 1_000)
    await limiter.acquire('a')
    limiter.observe('a', { remaining: 0, resetAtMs: Date.now() + 1_000 })
    const next = limiter.acquire('a')
    expect(await settled(next)).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await settled(next)).toBe(true)
  })

  it('lets an interactive read go ahead of queued background calls', async () => {
    const limiter = new PlaneRateLimiter(1, 1_000)
    await limiter.acquire('a')
    const order: string[] = []
    const background = limiter.acquire('a', 'background').then(() => order.push('background'))
    const interactive = limiter.acquire('a', 'interactive').then(() => order.push('interactive'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(order).toEqual(['interactive'])
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all([background, interactive])
    expect(order).toEqual(['interactive', 'background'])
  })
})

describe('PlaneRateLimiter waitingUntilMs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says until when a queued call waits, and nothing once it went', async () => {
    const limiter = new PlaneRateLimiter(1, 1_000)
    expect(limiter.waitingUntilMs()).toBeNull()
    await limiter.acquire('a')
    const queued = limiter.acquire('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(limiter.waitingUntilMs()).toBe(Date.now() + 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await queued
    expect(limiter.waitingUntilMs()).toBeNull()
  })
})

describe('parsePlaneRateLimitHeaders', () => {
  it("reads Plane's remaining count and unix-seconds reset", () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '239',
      'x-ratelimit-reset': '1800000060'
    })
    expect(parsePlaneRateLimitHeaders(headers)).toEqual({
      remaining: 239,
      resetAtMs: 1_800_000_060_000
    })
  })

  it('is null when the server sends no usable remaining count', () => {
    expect(parsePlaneRateLimitHeaders(new Headers())).toBeNull()
    expect(parsePlaneRateLimitHeaders(new Headers({ 'x-ratelimit-remaining': 'x' }))).toBeNull()
    expect(parsePlaneRateLimitHeaders(new Headers({ 'x-ratelimit-remaining': '-1' }))).toBeNull()
  })
})

describe('parsePlaneRetryAfterMs', () => {
  it('parses a numeric delay-seconds value', () => {
    expect(parsePlaneRetryAfterMs('120')).toBe(120_000)
  })

  it('parses an HTTP-date value', () => {
    const future = new Date(Date.now() + 90_000)
    const parsed = parsePlaneRetryAfterMs(future.toUTCString())
    expect(parsed).not.toBeNull()
    expect(parsed as number).toBeGreaterThan(85_000)
    expect(parsed as number).toBeLessThanOrEqual(90_000)
  })

  it('returns null for missing, empty, or garbage values', () => {
    expect(parsePlaneRetryAfterMs(null)).toBeNull()
    expect(parsePlaneRetryAfterMs(undefined)).toBeNull()
    expect(parsePlaneRetryAfterMs('')).toBeNull()
    expect(parsePlaneRetryAfterMs('not-a-date')).toBeNull()
  })

  it('returns null for non-positive delay-seconds', () => {
    expect(parsePlaneRetryAfterMs('0')).toBeNull()
    expect(parsePlaneRetryAfterMs('-5')).toBeNull()
  })
})
