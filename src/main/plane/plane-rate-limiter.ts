// Sliding-window request limiter + Retry-After parsing for Plane's REST API.
// Pure primitives only — the bounded-retry loop that consumes these lives in
// the Slice 3 client.

export const PLANE_RATE_LIMIT_DEFAULT_MAX_REQUESTS = 60
export const PLANE_RATE_LIMIT_WINDOW_MS = 60_000

// Why: a corrupt/hostile Retry-After must not stall the caller for days (same
// cap used for Claude/GitHub Retry-After handling elsewhere in this codebase).
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sliding-window rate limiter keyed per workspace (or any caller-chosen key).
 * `acquire` resolves once a slot is free, waiting out the window otherwise.
 */
export class PlaneRateLimiter {
  private readonly timestampsByKey = new Map<string, number[]>()

  constructor(
    private readonly maxRequests = PLANE_RATE_LIMIT_DEFAULT_MAX_REQUESTS,
    private readonly windowMs = PLANE_RATE_LIMIT_WINDOW_MS
  ) {}

  /** Awaits a free slot in `key`'s sliding window, then records the request. */
  async acquire(key: string): Promise<void> {
    for (;;) {
      const now = Date.now()
      const active = (this.timestampsByKey.get(key) ?? []).filter((at) => now - at < this.windowMs)

      if (active.length < this.maxRequests) {
        active.push(now)
        this.timestampsByKey.set(key, active)
        return
      }

      this.timestampsByKey.set(key, active)
      const waitMs = Math.max(this.windowMs - (now - active[0]), 1)
      await sleep(waitMs)
    }
  }
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
