import type { ProviderRateLimits, RateLimitWindow } from './rate-limit-types'

/** At or past this share of a window, the account cannot serve another request. */
export const EXHAUSTED_USED_PERCENT = 100

/**
 * The windows that gate the whole account.
 *
 * Why `fableWeekly` is not one of them: it caps a single model family, so a saturated
 * Fable window says nothing about whether the account can still run.
 */
export function getAccountQuotaWindows(limits: ProviderRateLimits): RateLimitWindow[] {
  return [limits.session, limits.weekly, limits.monthly ?? null, ...(limits.buckets ?? [])].filter(
    (window): window is RateLimitWindow => window !== null
  )
}

/**
 * The exhausted window whose reset has not passed yet, or null when none applies.
 *
 * Why a measurement can outlive the read that failed after it: the account that hit
 * its limit is exactly the one whose refresh its own live terminal defers, so
 * demanding a fresh read made exhaustion the single state Orca could never observe.
 * A window at 100% is still at 100% until it resets; once `resetsAt` passes, the old
 * number proves nothing. An undated window never qualifies, so trust in a retained
 * measurement always expires on its own.
 */
export function findUnresetExhaustedWindow(
  limits: ProviderRateLimits,
  now: number
): RateLimitWindow | null {
  return (
    getAccountQuotaWindows(limits).find(
      (window) =>
        window.usedPercent >= EXHAUSTED_USED_PERCENT &&
        window.resetsAt !== null &&
        window.resetsAt > now
    ) ?? null
  )
}
