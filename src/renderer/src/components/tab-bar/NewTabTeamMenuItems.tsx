import React, { useState } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { TeamTodoTicket } from '../../../../shared/team-panel-model-types'
import type { AgentRowAccount } from './new-tab-agent-row-account'
import { NewTabAgentAccountSubmenu } from './NewTabAgentAccountSubmenu'
import type { NewTabTeamMenuState } from './new-tab-team-menu-state'

type Provider = 'claude' | 'codex'

export type NewTabTeamMenuItemsProps = {
  state: Extract<NewTabTeamMenuState, { kind: 'lead-live' | 'lead-closed' }>
  /** The member agent's accounts while a lead is live; Claude's for a fresh lead. */
  account: AgentRowAccount
  labelOf: (provider: Provider, accountId: string | null) => string
  onGoToLead: () => void
  onAddMember: (ticket: TeamTodoTicket, accountId: string | null) => void
  onReopen: () => void
  onStartFresh: (accountId: string | null) => void
}

const ROW = 'gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium'
const LABEL = 'px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground'

/** The + menu's Team group: the project's live or kept lead, never a second team (ORCA-717). */
export function NewTabTeamMenuItems(props: NewTabTeamMenuItemsProps): React.JSX.Element {
  const { state, account } = props
  const [picked, setPicked] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const accountId = account.kind === 'picker' ? (picked ?? account.checkedId) : null

  const accountBeside = (ariaLabel: string): React.JSX.Element | null => {
    if (account.kind === 'picker') {
      return (
        <NewTabAgentAccountSubmenu
          provider={account.provider}
          ariaLabel={ariaLabel}
          triggerLabel={props.labelOf(account.provider, accountId)}
          rows={account.rows}
          checkedId={accountId}
          labelOf={(row) => props.labelOf(account.provider, row.id)}
          onPick={setPicked}
          keepOpen
        />
      )
    }
    if (account.kind === 'own-login' || account.kind === 'host-login') {
      return (
        <span className="shrink-0 px-1.5 text-[11px] text-muted-foreground">
          {account.kind === 'own-login'
            ? translate('newTabMenu.account.ownLogin', 'Own login')
            : translate('newTabMenu.account.hostLogin', 'Host login')}
        </span>
      )
    }
    return null
  }
  const memberAccount =
    state.kind === 'lead-live'
      ? accountBeside(translate('newTabMenu.team.chooseMember', "Choose the member's account"))
      : null

  return (
    <>
      <DropdownMenuLabel className={LABEL}>
        {translate('newTabMenu.team.group', 'Team')}
      </DropdownMenuLabel>
      {state.kind === 'lead-live' ? (
        <>
          <DropdownMenuItem className={ROW} onSelect={props.onGoToLead}>
            <span className="truncate">
              {state.leadName
                ? translate('newTabMenu.team.goToLead', 'Go to lead {{value}}', {
                    value: state.leadName
                  })
                : translate('newTabMenu.team.goToLeadUnnamed', 'Go to lead')}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={ROW}>
              <span className="truncate">
                {translate('newTabMenu.team.addMember', 'Add a member to the team…')}
              </span>
            </DropdownMenuSubTrigger>
            {/* Why the account inside: beside the row its chevron doubled the row's and cut the label. */}
            <DropdownMenuSubContent className="w-72">
              {memberAccount ? (
                <>
                  <div className="flex items-center">
                    <span className={`min-w-0 flex-1 truncate ${LABEL}`}>
                      {translate('newTabMenu.team.memberAccount', 'Member account')}
                    </span>
                    {memberAccount}
                  </div>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {state.todo.length === 0 ? (
                <DropdownMenuItem disabled className={ROW}>
                  {translate('newTabMenu.team.todoEmpty', 'To Do is empty')}
                </DropdownMenuItem>
              ) : (
                state.todo.map((ticket) => (
                  <DropdownMenuItem
                    key={ticket.identifier}
                    className={ROW}
                    onSelect={() => props.onAddMember(ticket, accountId)}
                  >
                    <span className="shrink-0">{ticket.identifier}</span>
                    <span className="truncate font-normal text-muted-foreground">
                      {ticket.title}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ) : (
        <>
          <DropdownMenuItem className={ROW} onSelect={props.onReopen}>
            <span className="flex-1 truncate">
              {translate('newTabMenu.team.reopen', 'Reopen team')}
            </span>
            <span className="truncate text-[11px] font-normal text-muted-foreground">
              {props.labelOf('claude', state.accountId)}
            </span>
          </DropdownMenuItem>
          {confirming ? (
            <>
              <DropdownMenuLabel className={LABEL}>
                {translate('newTabMenu.team.startFreshConfirm', 'Start a fresh lead?')}
              </DropdownMenuLabel>
              <div className="flex items-center gap-1">
                <DropdownMenuItem
                  className={`flex-1 ${ROW}`}
                  onSelect={() => props.onStartFresh(accountId)}
                >
                  {translate('newTabMenu.team.start', 'Start')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={`flex-1 ${ROW} text-muted-foreground`}
                  onSelect={(event) => {
                    event.preventDefault()
                    setConfirming(false)
                  }}
                >
                  {translate('newTabMenu.team.cancel', 'Cancel')}
                </DropdownMenuItem>
              </div>
            </>
          ) : (
            <div className="flex items-center">
              <DropdownMenuItem
                className={`min-w-0 flex-1 ${ROW}`}
                onSelect={(event) => {
                  // Why in the menu: starting fresh retires the kept lead, so it asks first, no dialog.
                  event.preventDefault()
                  setConfirming(true)
                }}
              >
                <span className="truncate">
                  {translate('newTabMenu.team.startFresh', 'Start fresh lead…')}
                </span>
              </DropdownMenuItem>
              {accountBeside(translate('newTabMenu.team.chooseLead', "Choose the lead's account"))}
            </div>
          )}
        </>
      )}
    </>
  )
}
