import { useEffect, useMemo, useState } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { claudeAccountSwitchLabel } from './use-manual-claude-account-switch'
import type { ClaudeManagedAccountSummary } from '../../../../shared/types'

/** Fetches and splits switchable Claude accounts while `enabled`, keeping the
 *  managed OAuth accounts and custom-endpoint accounts in separate groups. */
export function useClaudeAccountSwitchTargets(enabled: boolean): {
  oauthAccounts: ClaudeManagedAccountSummary[]
  endpointAccounts: ClaudeManagedAccountSummary[]
} {
  const [accounts, setAccounts] = useState<ClaudeManagedAccountSummary[]>([])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const list = window.api?.claudeAccounts?.list
    if (!list) {
      return
    }
    let cancelled = false
    void list()
      .then((result) => {
        if (!cancelled) {
          setAccounts(result.accounts)
        }
      })
      .catch(() => {
        // Non-fatal: the action shows its empty state when the list is unavailable.
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return useMemo(
    () => ({
      oauthAccounts: accounts.filter((account) => account.authMethod !== 'custom-endpoint'),
      endpointAccounts: accounts.filter((account) => account.authMethod === 'custom-endpoint')
    }),
    [accounts]
  )
}

const SECTION_LABEL_CLASS = 'px-2 py-1 text-[11px] font-medium text-muted-foreground'

/**
 * The account rows for a "switch account & continue" menu: managed OAuth
 * accounts first, custom-endpoint accounts (e.g. z.ai) framed as a last resort.
 * Shared by the dropdown submenu (context/native-chat menus) and the pane
 * header's button popover so the ordering and labels stay identical.
 */
export function ClaudeAccountSwitchList({
  oauthAccounts,
  endpointAccounts,
  onSelect
}: {
  oauthAccounts: ClaudeManagedAccountSummary[]
  endpointAccounts: ClaudeManagedAccountSummary[]
  onSelect: (account: ClaudeManagedAccountSummary) => void
}): React.JSX.Element {
  if (oauthAccounts.length === 0 && endpointAccounts.length === 0) {
    return (
      <DropdownMenuItem disabled className="text-muted-foreground">
        {translate(
          'auto.components.terminalPane.ClaudeAccountSwitchList.empty',
          'No accounts available'
        )}
      </DropdownMenuItem>
    )
  }

  const renderAccount = (account: ClaudeManagedAccountSummary): React.JSX.Element => (
    <DropdownMenuItem key={account.id} onSelect={() => onSelect(account)}>
      <span className="min-w-0 flex-1 truncate">{claudeAccountSwitchLabel(account)}</span>
    </DropdownMenuItem>
  )

  return (
    <>
      {oauthAccounts.length > 0 ? (
        <>
          <DropdownMenuLabel className={SECTION_LABEL_CLASS}>
            {translate(
              'auto.components.terminalPane.TerminalClaudeAccountSwitchMenu.claudeSection',
              'Claude accounts'
            )}
          </DropdownMenuLabel>
          {oauthAccounts.map(renderAccount)}
        </>
      ) : null}
      {oauthAccounts.length > 0 && endpointAccounts.length > 0 ? <DropdownMenuSeparator /> : null}
      {endpointAccounts.length > 0 ? (
        <>
          <DropdownMenuLabel className={SECTION_LABEL_CLASS}>
            {translate(
              'auto.components.terminalPane.TerminalClaudeAccountSwitchMenu.endpointSection',
              'Last resort'
            )}
          </DropdownMenuLabel>
          {endpointAccounts.map(renderAccount)}
        </>
      ) : null}
    </>
  )
}
