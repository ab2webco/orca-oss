import { KeyRound } from 'lucide-react'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { ClaudeAccountAuthRowStatus } from './claude-account-auth-row-status'
import { describeQuotaParts } from './claude-account-quota-text'
import {
  describeStoredLogin,
  describeTokenCheck,
  describeTokenTerm
} from './claude-account-token-status-text'

/** A token account's row: the token's state first, then its term, the stored login and quota. */
export function ClaudeAccountTokenStatusLine({
  status,
  usage,
  now
}: {
  status: ClaudeAccountAuthRowStatus
  usage: ProviderRateLimits | null
  now: number
}): React.JSX.Element {
  const term = describeTokenTerm(status.tokenSavedAt, now)
  const quota = describeQuotaParts(usage, now)
  const tone =
    status.tone === 'positive'
      ? 'text-status-success'
      : status.tone === 'negative'
        ? 'text-destructive'
        : 'text-muted-foreground'
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-[11px]">
      <span className="flex min-w-0 items-center gap-1.5">
        <KeyRound className={cn('size-3 shrink-0', tone)} />
        <span
          className={cn(
            'min-w-0',
            status.tone === 'negative' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {describeTokenCheck(status.tokenCheck, now)}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
        {term ? (
          <>
            <span className={cn(term.soon && 'text-status-warning')}>{term.expiry}</span>
            <span>{term.saved}</span>
          </>
        ) : null}
        <span>{describeStoredLogin(status, now)}</span>
        {quota.length > 0 ? (
          quota.map((part) => <span key={part}>{part}</span>)
        ) : (
          <span>
            {translate(
              'auto.components.settings.ClaudeAccountAuthStatusLine.quotaUnreadableOnToken',
              'Quota unavailable'
            )}
          </span>
        )}
      </span>
    </span>
  )
}
