import { useState } from 'react'
import { UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { ClaudeAccountSwitchList, useClaudeAccountSwitchTargets } from './ClaudeAccountSwitchList'
import type { ClaudeManagedAccountSummary } from '../../../../shared/types'

/**
 * Pane-header affordance to switch the current terminal's Claude account and
 * continue the session. The header row uses icon buttons rather than a menu, so
 * this wraps the shared account list in a button-triggered popover. Accounts are
 * fetched only while the popover is open.
 */
export function TerminalClaudeAccountSwitchButton({
  onSwitch
}: {
  onSwitch: (account: ClaudeManagedAccountSummary) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { oauthAccounts, endpointAccounts } = useClaudeAccountSwitchTargets(open)
  const label = translate(
    'auto.components.terminalPane.TerminalClaudeAccountSwitchMenu.trigger',
    'Switch Account & Continue'
  )
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="pane-title-split-trigger"
              aria-label={label}
              onClick={(event) => event.stopPropagation()}
            >
              <UserCog className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ClaudeAccountSwitchList
          oauthAccounts={oauthAccounts}
          endpointAccounts={endpointAccounts}
          onSelect={(account) => {
            setOpen(false)
            onSwitch(account)
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
