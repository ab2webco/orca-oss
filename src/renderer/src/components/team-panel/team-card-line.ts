import { translate } from '@/i18n/i18n'
import type { TeamLeadCard, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { teamIdleCiOf } from '../../../../shared/team-member-shown-state'
import { teamAskText, teamLeadLiveText, teamMemberLiveText } from './team-card-text'

/** A Team card's status line and whether it reads in the attention tone. */
export type TeamCardLine = { text: string; attention: boolean }

// Why one source: the sidebar row said 'Working' while this card said the lead asks you (ORCA-1366).
export function teamLeadCardLine(
  lead: Pick<TeamLeadCard, 'ownerAsk' | 'liveAction' | 'condition' | 'waitingOn'>
): TeamCardLine {
  if (lead.ownerAsk) {
    return {
      text: lead.ownerAsk.ticket
        ? translate('teamPanel.lead.asksOn', 'Waiting for you · Question on {{ticket}}', {
            ticket: lead.ownerAsk.ticket
          })
        : translate('teamPanel.lead.asks', 'Waiting for you'),
      attention: true
    }
  }
  return {
    text: teamLeadLiveText(lead.liveAction, lead.condition, lead.waitingOn),
    attention: false
  }
}

/** The question itself is only in Inbox; a permission prompt is named, and a stopped member's red CI says so. */
export function teamMemberCardLine(
  card: Pick<TeamMemberCard, 'needsYou' | 'ask' | 'condition' | 'liveAction' | 'pr'>
): TeamCardLine {
  return {
    text: card.needsYou && card.ask !== null ? teamAskText(card.ask) : teamMemberLiveText(card),
    attention: card.needsYou || teamIdleCiOf(card) === 'failure'
  }
}
