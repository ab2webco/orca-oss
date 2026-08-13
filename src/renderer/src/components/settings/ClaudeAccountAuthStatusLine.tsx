import { CheckCircle2, HelpCircle, Loader2, ShieldAlert } from 'lucide-react'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { formatResetDuration } from '../../../../shared/rate-limit-reset-format'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { ClaudeAccountAuthRowStatus } from './claude-account-auth-row-status'

function formatCheckedAgo(checkedAt: number, now: number): string {
  const elapsed = Math.max(0, now - checkedAt)
  if (elapsed < 60_000) {
    return translate('auto.components.settings.ClaudeAccountAuthStatusLine.justNow', 'just now')
  }
  return translate(
    'auto.components.settings.ClaudeAccountAuthStatusLine.checkedAgo',
    '{{value0}} ago',
    { value0: formatResetDuration(elapsed) }
  )
}

function describeStatus(status: ClaudeAccountAuthRowStatus, now: number): string {
  switch (status.kind) {
    case 'checking':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.checking',
        'Checking sign-in…'
      )
    case 'verified':
      return status.checkedAt === null
        ? translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.verified',
            'Sign-in verified'
          )
        : translate(
            'auto.components.settings.ClaudeAccountAuthStatusLine.verifiedAt',
            'Sign-in verified {{value0}}',
            { value0: formatCheckedAgo(status.checkedAt, now) }
          )
    case 'credential-rejected':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.rejected',
        'Sign-in expired — re-authenticate this account'
      )
    case 'no-credentials':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.missing',
        'No stored credential — re-authenticate this account'
      )
    case 'unchecked':
      return translate(
        'auto.components.settings.ClaudeAccountAuthStatusLine.unchecked',
        'Sign-in not checked yet'
      )
  }
}

function describeUndecided(status: ClaudeAccountAuthRowStatus): string | null {
  if (!status.undecided || status.kind === 'checking') {
    return null
  }
  if (status.undecided === 'live-session-holds-token') {
    return translate(
      'auto.components.settings.ClaudeAccountAuthStatusLine.undecidedLiveSession',
      'last check deferred: a running session holds this token'
    )
  }
  return translate(
    'auto.components.settings.ClaudeAccountAuthStatusLine.undecided',
    'last check could not confirm it'
  )
}

function describeQuota(usage: ProviderRateLimits | null, now: number): string | null {
  if (!usage || usage.status !== 'ok') {
    return null
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
  return parts.length > 0 ? parts.join(' · ') : null
}

export function ClaudeAccountAuthStatusLine({
  status,
  usage,
  now
}: {
  status: ClaudeAccountAuthRowStatus
  usage: ProviderRateLimits | null
  now: number
}): React.JSX.Element {
  const Icon =
    status.kind === 'checking'
      ? Loader2
      : status.tone === 'positive'
        ? CheckCircle2
        : status.tone === 'negative'
          ? ShieldAlert
          : HelpCircle
  const undecided = describeUndecided(status)
  const quota =
    describeQuota(usage, now) ??
    // Why: a row that already states the failure explains the missing figure; on
    // any other row silence would read as "0% used".
    (status.tone === 'negative'
      ? null
      : translate(
          'auto.components.settings.ClaudeAccountAuthStatusLine.quotaUnknown',
          'remaining quota unknown'
        ))
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
      <Icon
        className={cn(
          'size-3 shrink-0',
          status.kind === 'checking' && 'animate-spin',
          status.tone === 'positive' && 'text-status-success',
          status.tone === 'negative' && 'text-destructive',
          status.tone === 'neutral' && 'text-muted-foreground'
        )}
      />
      <span
        className={cn(
          'truncate',
          status.tone === 'negative' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {describeStatus(status, now)}
      </span>
      {undecided ? <span className="truncate text-muted-foreground">· {undecided}</span> : null}
      {quota ? <span className="truncate text-muted-foreground">· {quota}</span> : null}
    </span>
  )
}
