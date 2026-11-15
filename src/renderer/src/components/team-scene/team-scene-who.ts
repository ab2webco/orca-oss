import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { teamConditionText, teamHostText, teamTicketBesideName } from '../team-panel/team-card-text'
import { openTeamSession } from '../team-panel/team-session-open'
import type { TeamSceneWho } from './team-scene-hit'

/** Each member's scene label, from its card: name, then ticket, state and host, as the row says. */
export function teamSceneWhoOf(
  members: readonly TeamMemberCard[]
): ReadonlyMap<string, TeamSceneWho> {
  return new Map(
    members.map((card) => [
      card.paneKey,
      {
        title: card.name,
        detail: [
          teamTicketBesideName(card, true),
          teamConditionText(card.condition),
          teamHostText(card.host)
        ]
          .filter(Boolean)
          .join(' · '),
        open: () => void openTeamSession(card, card.name)
      }
    ])
  )
}
