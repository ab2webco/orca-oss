/** A Plane read held back by the rate limit (`limit`) or a 429 retry (`retry`) for `waitMs` more. */
export type PlaneRateLimitWait = { reason: 'limit' | 'retry'; waitMs: number }
