import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { formatResetDuration } from '../../../../shared/rate-limit-reset-format'
import { translate } from '@/i18n/i18n'

/** One phrase per usage window the stored login read; empty when it read none. */
export function describeQuotaParts(usage: ProviderRateLimits | null, now: number): string[] {
  if (!usage || usage.status !== 'ok') {
    return []
  }
  const parts: string[] = []
  if (usage.session) {
    parts.push(
      usage.session.resetsAt === null
        ? translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.sessionUsed',
            '5h {{value0}}% used',
            { value0: Math.round(usage.session.usedPercent) }
          )
        : translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.sessionUsedResets',
            '5h {{value0}}% used, resets in {{value1}}',
            {
              value0: Math.round(usage.session.usedPercent),
              value1: formatResetDuration(usage.session.resetsAt - now)
            }
          )
    )
  }
  if (usage.weekly) {
    parts.push(
      usage.weekly.resetsAt === null
        ? translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.weeklyUsed',
            '7d {{value0}}% used',
            { value0: Math.round(usage.weekly.usedPercent) }
          )
        : translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.weeklyUsedResets',
            '7d {{value0}}% used, resets in {{value1}}',
            {
              value0: Math.round(usage.weekly.usedPercent),
              value1: formatResetDuration(usage.weekly.resetsAt - now)
            }
          )
    )
  }
  return parts
}
