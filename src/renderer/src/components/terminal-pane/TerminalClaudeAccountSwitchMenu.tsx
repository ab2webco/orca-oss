import { UserCog } from 'lucide-react'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { ClaudeAccountSwitchList, useClaudeAccountSwitchTargets } from './ClaudeAccountSwitchList'
import type { ClaudeManagedAccountSummary } from '../../../../shared/types'

type Props = {
  /** Fetch accounts only while the owning menu is open. */
  enabled: boolean
  onSwitch: (account: ClaudeManagedAccountSummary) => void
}

/**
 * Dropdown submenu that switches the current terminal's Claude account and
 * continues the session. Rendered inside an already-open DropdownMenu (terminal
 * context menu, native-chat context menu). The parent gates it on the pane being
 * a Claude agent session.
 */
export function TerminalClaudeAccountSwitchMenu({ enabled, onSwitch }: Props): React.JSX.Element {
  const { oauthAccounts, endpointAccounts } = useClaudeAccountSwitchTargets(enabled)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <UserCog />
        {translate(
          'auto.components.terminalPane.TerminalClaudeAccountSwitchMenu.trigger',
          'Switch Account & Continue'
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <ClaudeAccountSwitchList
          oauthAccounts={oauthAccounts}
          endpointAccounts={endpointAccounts}
          onSelect={onSwitch}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
