// Sliding-window request limiter + rate-limit header parsing for Plane's REST API.
// Pure primitives only — the bounded-retry loop that consumes these lives in
// the Slice 3 client.

export const PLANE_RATE_LIMIT_DEFAULT_MAX_REQUESTS = 60
export const PLANE_RATE_LIMIT_WINDOW_MS = 60_000

// Why: a corrupt/hostile Retry-After must not stall the caller for days (same
// cap used for Claude/GitHub Retry-After handling elsewhere in this codebase).
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

export type PlaneCallPriority = 'interactive' | 'background'

/** What Plane's ApiKeyRateThrottle reports on each response. */
export type PlaneRateLimitReading = { remaining: number; resetAtMs: number }

type Waiter = { priority: PlaneCallPriority; resolve: () => void }

type KeyState = {
  timestamps: number[]
  waiters: Waiter[]
  timer: ReturnType<typeof setTimeout> | null
  timerDueMs: number
  /** Largest budget the server has shown; the fallback is only a floor. */
  learnedMax: number | null
  /** The server's last remaining count, less what was sent since. */
  remaining: { left: number; untilMs: number } | null
}

/**
 * Sliding-window rate limiter keyed per workspace (or any caller-chosen key).
 * The window grows to what the server reports, and interactive calls go first.
 */
export class PlaneRateLimiter {
  private readonly states = new Map<string, KeyState>()

  constructor(
    private readonly maxRequests = PLANE_RATE_LIMIT_DEFAULT_MAX_REQUESTS,
    private readonly windowMs = PLANE_RATE_LIMIT_WINDOW_MS
  ) {}

  /** Awaits a free slot in `key`'s window, interactive callers ahead of background ones. */
  acquire(key: string, priority: PlaneCallPriority = 'interactive'): Promise<void> {
    return new Promise((resolve) => {
      const state = this.stateOf(key)
      const waiter = { priority, resolve }
      // Why after the last interactive: callers of one priority keep their arrival order.
      const at =
        priority === 'interactive'
          ? state.waiters.findIndex((one) => one.priority === 'background')
          : -1
      state.waiters.splice(at === -1 ? state.waiters.length : at, 0, waiter)
      this.pump(key, state)
    })
  }

  /** Records what the server reported for the request just answered. */
  observe(key: string, reading: PlaneRateLimitReading | null): void {
    if (!reading) {
      return
    }
    const state = this.stateOf(key)
    const now = Date.now()
    const active = this.active(state, now).length
    state.learnedMax = Math.max(state.learnedMax ?? 0, reading.remaining + active)
    state.remaining = { left: reading.remaining, untilMs: Math.max(reading.resetAtMs, now) }
    this.pump(key, state)
  }

  /** A 429 means the learned budget was wrong; fall back until the server reports again. */
  forget(key: string): void {
    const state = this.stateOf(key)
    state.learnedMax = null
    state.remaining = null
  }

  /** When the soonest queued call can go; null while nothing waits. */
  waitingUntilMs(): number | null {
    let soonest: number | null = null
    for (const state of this.states.values()) {
      if (state.timer && state.waiters.length > 0) {
        soonest = Math.min(soonest ?? state.timerDueMs, state.timerDueMs)
      }
    }
    return soonest
  }

  private stateOf(key: string): KeyState {
    let state = this.states.get(key)
    if (!state) {
      state = {
        timestamps: [],
        waiters: [],
        timer: null,
        timerDueMs: 0,
        learnedMax: null,
        remaining: null
      }
      this.states.set(key, state)
    }
    return state
  }

  private active(state: KeyState, now: number): number[] {
    state.timestamps = state.timestamps.filter((at) => now - at < this.windowMs)
    return state.timestamps
  }

  private waitMs(state: KeyState, now: number): number {
    const active = this.active(state, now)
    if (state.remaining && now >= state.remaining.untilMs) {
      state.remaining = null
    }
    const max = Math.max(this.maxRequests, state.learnedMax ?? 0)
    const full = active.length >= max || (state.remaining !== null && state.remaining.left <= 0)
    if (!full) {
      return 0
    }
    const oldestFrees = active.length > 0 ? this.windowMs - (now - active[0]) : 0
    const serverFrees = state.remaining ? state.remaining.untilMs - now : 0
    // Why <= 0: calls sent since the last reading can push the count below zero.
    const serverEmpty = state.remaining !== null && state.remaining.left <= 0
    return Math.max(serverEmpty ? serverFrees : oldestFrees, 1)
  }

  private pump(key: string, state: KeyState): void {
    while (state.waiters.length > 0) {
      const now = Date.now()
      const wait = this.waitMs(state, now)
      if (wait > 0) {
        if (!state.timer) {
          state.timerDueMs = now + wait
          state.timer = setTimeout(() => {
            state.timer = null
            this.pump(key, state)
          }, wait)
        }
        return
      }
      const next = state.waiters.shift()!
      state.timestamps.push(now)
      if (state.remaining) {
        state.remaining.left -= 1
      }
      next.resolve()
    }
  }
}

/** Reads `X-RateLimit-Remaining` and the unix-seconds `X-RateLimit-Reset`; null when absent. */
export function parsePlaneRateLimitHeaders(headers: Headers): PlaneRateLimitReading | null {
  const remaining = Number(headers.get('x-ratelimit-remaining') ?? Number.NaN)
  if (!Number.isInteger(remaining) || remaining < 0) {
    return null
  }
  const resetSeconds = Number(headers.get('x-ratelimit-reset') ?? Number.NaN)
  const resetAtMs = Number.isFinite(resetSeconds)
    ? resetSeconds * 1000
    : Date.now() + PLANE_RATE_LIMIT_WINDOW_MS
  return { remaining, resetAtMs }
}

/**
 * Parses an HTTP `Retry-After` header value into a millisecond delay.
 * Supports both delay-seconds ("120") and HTTP-date forms (RFC 9110).
 * Returns null for missing, non-positive, past, or unparsable values.
 */
export function parsePlaneRetryAfterMs(headerValue: string | null | undefined): number | null {
  if (!headerValue) {
    return null
  }
  const trimmed = headerValue.trim()
  if (!trimmed) {
    return null
  }

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null
  }

  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) {
    return null
  }
  const delta = dateMs - Date.now()
  return delta > 0 ? Math.min(delta, MAX_RETRY_AFTER_MS) : null
}
