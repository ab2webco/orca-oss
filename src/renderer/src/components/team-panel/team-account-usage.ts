import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { TeamAccount } from '../../../../shared/team-panel-model-types'

export type TeamUsageWindow = { usedPercent: number; resetsAt: number | null }

export type TeamAccountWindows = { session: TeamUsageWindow | null; weekly: TeamUsageWindow | null }

const percentOnly = (usedPercent: number | null | undefined): TeamUsageWindow | null =>
  usedPercent == null ? null : { usedPercent, resetsAt: null }

/** The 5 h and week windows: this host's own reading when good, else the game's percents. */
export function teamAccountWindowsOf(
  account: TeamAccount,
  limits: ProviderRateLimits | null
): TeamAccountWindows {
  // Why the host's reading first: it is what the status bar shows, resets included.
  if (limits?.status === 'ok' && (limits.session || limits.weekly)) {
    return {
      session: limits.session
        ? { usedPercent: limits.session.usedPercent, resetsAt: limits.session.resetsAt }
        : null,
      weekly: limits.weekly
        ? { usedPercent: limits.weekly.usedPercent, resetsAt: limits.weekly.resetsAt }
        : null
    }
  }
  return { session: percentOnly(account.usedPercent), weekly: percentOnly(account.weeklyPercent) }
}
