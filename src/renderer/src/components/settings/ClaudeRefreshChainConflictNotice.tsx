import { Info, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'
import type {
  ManagedClaudeRefreshChainAliasConflictSet,
  ManagedClaudeRefreshChainAliasReport,
  ManagedClaudeRefreshChainAliasReportAccount
} from '../../../../shared/claude-refresh-chain-alias-report'

export type ClaudeRefreshChainConflictNoticeProps = {
  /** null while loading — the notice only takes space once there is something to say. */
  report: ManagedClaudeRefreshChainAliasReport | null
  /** Resolves a current-profile account's email from the roster; null when unknown. */
  resolveAccountEmail: (accountId: string) => string | null
  onReauthenticate: (accountId: string) => void
  /** Account currently mid re-authentication, for the row spinner. */
  reauthenticatingAccountId: string | null
  busy: boolean
}

// Exhaustive on purpose: a new certainty level from the core must force a copy
// decision here instead of silently reusing a stronger claim.
function certaintyDescription(
  certainty: ManagedClaudeRefreshChainAliasConflictSet['certainty']
): string {
  switch (certainty) {
    case 'recorded-chain-match':
      return translate(
        'auto.components.settings.ClaudeRefreshChainConflictNotice.description',
        'These saved logins match on the refresh chain Orca has recorded, so refreshing one can sign the other out. Orca pauses token rotation between them. Re-authenticate one of them to give it its own chain — its chats and history stay intact.'
      )
  }
}

function accountDisplayLabel(
  account: ManagedClaudeRefreshChainAliasReportAccount,
  resolveAccountEmail: (accountId: string) => string | null
): string {
  if (account.profileScope === 'other') {
    return translate(
      'auto.components.settings.ClaudeRefreshChainConflictNotice.otherProfileAccountLabel',
      'Claude account in another Orca profile'
    )
  }
  return (
    account.email ??
    resolveAccountEmail(account.accountId) ??
    translate(
      'auto.components.settings.ClaudeRefreshChainConflictNotice.fallbackAccountLabel',
      'Saved Claude account'
    )
  )
}

function ConflictAccountRow({
  account,
  resolveAccountEmail,
  onReauthenticate,
  reauthenticatingAccountId,
  busy
}: {
  account: ManagedClaudeRefreshChainAliasReportAccount
} & Pick<
  ClaudeRefreshChainConflictNoticeProps,
  'resolveAccountEmail' | 'onReauthenticate' | 'reauthenticatingAccountId' | 'busy'
>): React.JSX.Element {
  const isReauthing = reauthenticatingAccountId === account.accountId
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">
          {accountDisplayLabel(account, resolveAccountEmail)}
        </span>
        <Badge
          variant="outline"
          className="h-4 shrink-0 rounded px-1.5 text-[10px] font-medium leading-none"
        >
          {account.profileScope === 'current'
            ? translate(
                'auto.components.settings.ClaudeRefreshChainConflictNotice.currentProfileBadge',
                'This profile'
              )
            : translate(
                'auto.components.settings.ClaudeRefreshChainConflictNotice.otherProfileBadge',
                'Another profile'
              )}
        </Badge>
      </div>
      {account.profileScope === 'current' ? (
        <Button
          variant="outline"
          size="xs"
          onClick={() => onReauthenticate(account.accountId)}
          disabled={busy}
          className="h-6 shrink-0 gap-1.5 px-2"
        >
          {isReauthing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {translate(
            'auto.components.settings.ClaudeRefreshChainConflictNotice.reauthenticate',
            'Re-authenticate'
          )}
        </Button>
      ) : null}
    </li>
  )
}

export function ClaudeRefreshChainConflictNotice({
  report,
  resolveAccountEmail,
  onReauthenticate,
  reauthenticatingAccountId,
  busy
}: ClaudeRefreshChainConflictNoticeProps): React.JSX.Element | null {
  if (report === null) {
    return null
  }
  if (report.status !== 'available') {
    // "Could not look" is a different claim than "no conflicts" — say it.
    return (
      <div className="flex items-start gap-2 rounded-md border border-border/70 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {translate(
            'auto.components.settings.ClaudeRefreshChainConflictNotice.unavailable',
            "Orca couldn't verify whether saved Claude accounts share a refresh chain. If a shared chain exists, it is not shown here."
          )}
        </span>
      </div>
    )
  }
  if (report.conflictSets.length === 0) {
    return null
  }
  return (
    <div className="space-y-2">
      {report.conflictSets.map((conflict) => {
        const hasOtherProfileAccount = conflict.accounts.some(
          (account) => account.profileScope === 'other'
        )
        return (
          <div
            key={conflict.conflictId}
            className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300"
          >
            <p className="font-medium">
              {translate(
                'auto.components.settings.ClaudeRefreshChainConflictNotice.title',
                'These accounts share a recorded refresh chain'
              )}
            </p>
            <p>{certaintyDescription(conflict.certainty)}</p>
            <ul className="divide-y divide-amber-500/20">
              {conflict.accounts.map((account) => (
                <ConflictAccountRow
                  key={`${account.profileKey}:${account.accountId}`}
                  account={account}
                  resolveAccountEmail={resolveAccountEmail}
                  onReauthenticate={onReauthenticate}
                  reauthenticatingAccountId={reauthenticatingAccountId}
                  busy={busy}
                />
              ))}
            </ul>
            {hasOtherProfileAccount ? (
              <p>
                {translate(
                  'auto.components.settings.ClaudeRefreshChainConflictNotice.otherProfileHint',
                  'An account marked “Another profile” belongs to a different Orca profile on this machine, so it is not in the list above and cannot be re-authenticated from here. To fix it there instead, open that profile and re-authenticate the account in Settings → Accounts.'
                )}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
