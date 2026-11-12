import type { PlaneRateLimitWait } from '../../shared/plane-rate-limit-wait'
import { currentPlanePriority } from './plane-call-priority'
import {
  PlaneRateLimiter,
  parsePlaneRateLimitHeaders,
  parsePlaneRetryAfterMs
} from './plane-rate-limiter'

const rateLimiter = new PlaneRateLimiter()
// Bounded 429 fallback when the response carries no usable Retry-After; doubles per retry.
const DEFAULT_RETRY_DELAY_MS = 1000
const MAX_RATE_LIMIT_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const retryUntil = new Set<number>()

/** What a Plane read waits on now, for the Tasks page to say instead of a bare spinner. */
export function planeRateLimitWait(): PlaneRateLimitWait | null {
  const retry = retryUntil.size > 0 ? Math.min(...retryUntil) : null
  const limit = rateLimiter.waitingUntilMs()
  // Why a duration: a remote host's clock may differ from the page's.
  const waitMs = (until: number) => Math.max(0, until - Date.now())
  if (retry !== null && (limit === null || retry <= limit)) {
    return { reason: 'retry', waitMs: waitMs(retry) }
  }
  return limit === null ? null : { reason: 'limit', waitMs: waitMs(limit) }
}

// Bounded 429 retries honoring Retry-After; the caller sees the last response, never a loop.
export async function fetchWithPlaneRetry(
  send: (url: string, init: RequestInit) => Promise<Response>,
  rateLimiterKey: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await rateLimiter.acquire(rateLimiterKey, currentPlanePriority())
    const response = await send(url, init)
    rateLimiter.observe(rateLimiterKey, parsePlaneRateLimitHeaders(response.headers))
    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
      return response
    }
    rateLimiter.forget(rateLimiterKey)
    const retryAfterMs =
      parsePlaneRetryAfterMs(response.headers.get('retry-after')) ??
      DEFAULT_RETRY_DELAY_MS * 2 ** attempt
    const until = Date.now() + retryAfterMs
    retryUntil.add(until)
    await sleep(retryAfterMs).finally(() => retryUntil.delete(until))
  }
}
