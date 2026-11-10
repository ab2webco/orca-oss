import { memberNameOf, nextMemberName } from './orchestrator-game-member-names'
import type { GameMemberName } from './orchestrator-game-member-names'
import type { GameAgent } from './orchestrator-game-state'
import { ticketInText } from './orchestrator-game-ticket-id'

/** True for `NETSA-207 Replace…`: a ticket and its title, not a name that mentions a ticket. */
function isTicketTitle(shown: string): boolean {
  const ticket = ticketInText(shown)
  return ticket !== null && shown.trimStart().toUpperCase().startsWith(ticket)
}

/** A member's own name: its `<name> · ` prefix, else its shown name unless that is a ticket and its title. */
function launchedNameOf(agent: GameAgent): string | null {
  const shown = agent.displayName ?? agent.worktree?.displayName ?? agent.paneKey
  return memberNameOf(shown) ?? (isTicketTitle(shown) ? null : shown)
}

/** Each member's name: its own character, else the next free roster one, never its ticket title (V30). */
export function memberNamesOf(
  agents: readonly GameAgent[],
  roster: readonly GameMemberName[],
  taken: readonly string[],
  locale: string
): (string | null)[] {
  const launched = agents.map(launchedNameOf)
  const inUse = [...taken, ...launched.filter((one): one is string => one !== null)]
  return launched.map((name) => {
    if (name !== null) {
      return name
    }
    const next = nextMemberName(roster, inUse, locale)
    if (next !== null) {
      inUse.push(next)
    }
    return next
  })
}
