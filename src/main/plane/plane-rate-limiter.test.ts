import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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
