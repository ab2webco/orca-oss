import React, { useMemo } from 'react'
import { DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { agentRowAccountOf } from './new-tab-agent-row-account'
import { NewTabTeamMenuItems } from './NewTabTeamMenuItems'
import { QuickLaunchAgentMenuItems } from './QuickLaunchButton'
import { useNewTabAgentAccounts } from './use-new-tab-agent-accounts'
import { useNewTabTeamActions } from './use-new-tab-team-actions'
import { useNewTabTeamMenu } from './use-new-tab-team-menu'

type NewTabMenuSectionsProps = {
  worktreeId: string
  groupId: string
  onFocusTerminal: (tabId: string) => void
  /** The terminal, browser, markdown and emulator rows the tab bar already builds. */
  children: React.ReactNode
}

const HEADING = 'px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground'
const NO_HIDDEN: readonly TuiAgent[] = []
const TEAM_COVERED: readonly TuiAgent[] = ['claude-agent-teams']

/** The + menu as V10 groups it: Team, Terminal, Agents; mounts only while the menu is open (ORCA-717). */
export function NewTabMenuSections(props: NewTabMenuSectionsProps): React.JSX.Element {
  const { worktreeId, groupId, onFocusTerminal } = props
  const agentAccounts = useNewTabAgentAccounts(worktreeId)
  const menu = useNewTabTeamMenu(worktreeId)
  const actions = useNewTabTeamActions({ worktreeId, groupId, menu, onFocusTerminal })
  const { state } = menu
  const team = state.kind === 'lead-live' || state.kind === 'lead-closed' ? state : null
  // Why: a lead live, kept or restoring means the project has a team, so no second one.
  const hiddenAgents = state.kind === 'no-team' ? NO_HIDDEN : TEAM_COVERED
  const teamAccount = useMemo(
    () =>
      agentRowAccountOf({
        agent: team?.kind === 'lead-live' ? (team.memberAgent ?? 'claude') : 'claude-agent-teams',
        local: agentAccounts.local,
        providers: agentAccounts.providers,
        checked: 'member-default'
      }),
    [agentAccounts.local, agentAccounts.providers, team]
  )

  return (
    <>
      {team ? (
        <>
          <NewTabTeamMenuItems
            state={team}
            account={teamAccount}
            labelOf={agentAccounts.labelOf}
            {...actions}
            onReopen={() => void actions.onReopen()}
          />
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuLabel className={HEADING}>
        {translate('newTabMenu.group.terminal', 'Terminal')}
      </DropdownMenuLabel>
      {props.children}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={HEADING}>
        {translate('newTabMenu.group.agents', 'Agents')}
      </DropdownMenuLabel>
      <QuickLaunchAgentMenuItems
        worktreeId={worktreeId}
        groupId={groupId}
        onFocusTerminal={onFocusTerminal}
        agentAccounts={agentAccounts}
        hiddenAgents={hiddenAgents}
      />
    </>
  )
}
