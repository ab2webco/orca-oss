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
 *  managed OAuth accounts and custom-endpoint accounts in separate groups.
 *  Also surfaces the active account + its live model so the row can show it. */
export function useClaudeAccountSwitchTargets(enabled: boolean): {
  oauthAccounts: ClaudeManagedAccountSummary[]
  endpointAccounts: ClaudeManagedAccountSummary[]
  activeAccountId: string | null
  activeModel: string | null
} {
  const [accounts, setAccounts] = useState<ClaudeManagedAccountSummary[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<string | null>(null)

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
          setActiveAccountId(result.activeAccountId)
          setActiveModel(result.activeModel ?? null)
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
      endpointAccounts: accounts.filter((account) => account.authMethod === 'custom-endpoint'),
      activeAccountId,
      activeModel
    }),
    [accounts, activeAccountId, activeModel]
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
  onSelect,
  activeAccountId = null,
  activeModel = null
}: {
  oauthAccounts: ClaudeManagedAccountSummary[]
  endpointAccounts: ClaudeManagedAccountSummary[]
  onSelect: (account: ClaudeManagedAccountSummary) => void
  activeAccountId?: string | null
  activeModel?: string | null
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

  const renderAccount = (account: ClaudeManagedAccountSummary): React.JSX.Element => {
    // Only OAuth accounts show a live model suffix; endpoints already carry it in their label.
    const isActive = account.id === activeAccountId
    const modelSuffix =
      isActive && activeModel && account.authMethod !== 'custom-endpoint' ? activeModel : null
    return (
      <DropdownMenuItem key={account.id} onSelect={() => onSelect(account)}>
        <span className="min-w-0 flex-1 truncate">{claudeAccountSwitchLabel(account)}</span>
        {modelSuffix ? (
          <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{modelSuffix}</span>
        ) : null}
      </DropdownMenuItem>
    )
  }

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
