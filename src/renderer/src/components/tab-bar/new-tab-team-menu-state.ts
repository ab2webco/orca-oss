import type {
  TeamPanelGameModel,
  TeamSessionRef,
  TeamTodoTicket
} from '../../../../shared/team-panel-model-types'
import type { TeamLeadCaller } from '@/components/team-panel/team-panel-lead-read'
import type { StoredTeamLead } from './new-tab-stored-lead-read'

/** The project's lead as the + menu sees it; every input is already scoped to the active worktree's project. */
export type NewTabTeamMenuState =
  | { kind: 'no-team' }
  // Why: a lead restoring or a read not yet answered must not offer a second team.
  | { kind: 'pending' }
  | {
      kind: 'lead-live'
      leadName: string | null
      lead: TeamSessionRef
      todo: TeamTodoTicket[]
      memberAgent: string | null
    }
  | { kind: 'lead-closed'; accountId: string | null }

export type NewTabTeamMenuInput = {
  /** The menu's own `game.leads` read: `unread` until it answers. */
  liveLead: TeamLeadCaller | 'restoring' | 'unread' | null
  /** The model the Team panel last polled, when it is this project's. */
  team: (Pick<TeamPanelGameModel, 'lead' | 'todo'> & { memberAgent?: string }) | null
  // Why 'unknown': a host older than ORCA-717 cannot list kept leads, so Reopen is never offered on a guess.
  storedLead: StoredTeamLead | 'unread'
}

export function newTabTeamMenuStateOf(input: NewTabTeamMenuInput): NewTabTeamMenuState {
  const { liveLead, team } = input
  if (liveLead === 'restoring' || liveLead === 'unread') {
    return { kind: 'pending' }
  }
  if (liveLead) {
    // Why matched by pane: the panel polls every 20 s and may still hold the previous lead.
    const card = team?.lead.paneKey === liveLead.paneKey ? team.lead : null
    const { paneKey, terminalHandle, worktreeId } = card ?? liveLead
    return {
      kind: 'lead-live',
      leadName: card?.name ?? null,
      lead: { paneKey, terminalHandle, worktreeId, host: card?.host ?? { kind: 'local' } },
      todo: card && team ? team.todo : [],
      memberAgent: card ? (team?.memberAgent ?? null) : null
    }
  }
  if (input.storedLead === 'unread') {
    return { kind: 'pending' }
  }
  if (input.storedLead && input.storedLead !== 'unknown') {
    return { kind: 'lead-closed', accountId: input.storedLead.accountId }
  }
  return { kind: 'no-team' }
}
