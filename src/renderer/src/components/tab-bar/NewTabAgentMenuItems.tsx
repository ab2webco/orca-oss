import React from 'react'
import { QuickLaunchAgentMenuItems } from './QuickLaunchButton'
import { useNewTabAgentAccounts } from './use-new-tab-agent-accounts'

type NewTabAgentMenuItemsProps = {
  worktreeId: string
  groupId: string
  onFocusTerminal: (tabId: string) => void
}

/** The + menu's agent rows with each agent's launch account; mounts only while the menu is open. */
export function NewTabAgentMenuItems(props: NewTabAgentMenuItemsProps): React.JSX.Element {
  const agentAccounts = useNewTabAgentAccounts(props.worktreeId)
  return <QuickLaunchAgentMenuItems {...props} agentAccounts={agentAccounts} />
}
