import { useMemo } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { openTeamSession } from '@/components/team-panel/team-session-open'
import { useTeamLeadPrompt } from '@/components/team-panel/use-team-lead-prompt'
import type { TeamTodoTicket } from '../../../../shared/team-panel-model-types'
import { addMemberPromptOf } from './new-tab-add-member-prompt'
import { reopenTeamLead, type TeamLeadReopen } from './new-tab-lead-reopen'
import type { NewTabTeamMenu } from './use-new-tab-team-menu'

export type NewTabTeamActions = {
  onGoToLead: () => void
  onAddMember: (ticket: TeamTodoTicket, accountId: string | null) => void
  onReopen: () => Promise<void>
  onStartFresh: (accountId: string | null) => void
}

const FRESH_LEAD_PROMPT = '/orca-game:lead fresh'

function reopenFailureOf(answer: TeamLeadReopen): string | null {
  switch (answer.kind) {
    case 'lead':
      return null
    case 'failed':
      return translate('newTabMenu.team.reopenFailed', 'Could not reopen the team: {{value}}', {
        value: answer.reason
      })
    case 'nothing-kept':
      return translate('newTabMenu.team.reopenNothingKept', 'No kept lead to reopen')
    case 'unsupported':
      return translate('newTabMenu.team.reopenUnsupported', 'This host cannot reopen the team')
  }
}

/** What each Team row does; the lead and its kept conversation come from `menu` (ORCA-717). */
export function useNewTabTeamActions(args: {
  worktreeId: string
  groupId: string
  menu: NewTabTeamMenu
  onFocusTerminal: (tabId: string) => void
}): NewTabTeamActions {
  const { worktreeId, groupId, menu, onFocusTerminal } = args
  const live = menu.state.kind === 'lead-live' ? menu.state : null
  const sendToLead = useTeamLeadPrompt(live?.lead.terminalHandle ?? null)

  return useMemo(
    () => ({
      onGoToLead: () => {
        if (live) {
          const name = live.leadName ?? translate('newTabMenu.team.leadFallback', 'the lead')
          void openTeamSession(live.lead, name)
        }
      },
      onAddMember: (ticket, accountId) => {
        void sendToLead?.(
          `add-member:${ticket.identifier}`,
          addMemberPromptOf(ticket, accountId),
          ticket.identifier
        )
      },
      // Why the host and no pane here: /orca-game:lead in a new pane would reopen the lead beside it.
      onReopen: async () => {
        const answer = await reopenTeamLead(menu.target, {
          worktreeId,
          project: menu.projectName ?? ''
        }).catch(
          (error: unknown): TeamLeadReopen => ({
            kind: 'failed',
            reason: error instanceof Error ? error.message : String(error)
          })
        )
        const failure = reopenFailureOf(answer)
        if (failure) {
          toast.error(failure)
        }
      },
      onStartFresh: (accountId) => {
        const result = launchAgentInNewTab({
          agent: 'claude-agent-teams',
          worktreeId,
          groupId,
          prompt: FRESH_LEAD_PROMPT,
          ...(accountId ? { claudeAccountId: accountId } : {})
        })
        if (!result) {
          toast.error(
            translate(
              'auto.components.tab.bar.QuickLaunchButton.465e432ef1',
              'Could not build launch command for {{value0}}.',
              { value0: 'Claude Agent Teams' }
            )
          )
          return
        }
        if (result.tabId) {
          onFocusTerminal(result.tabId)
        }
      }
    }),
    [groupId, live, menu.projectName, menu.target, onFocusTerminal, sendToLead, worktreeId]
  )
}
