import type { GameProjectWork } from './orchestrator-game-project-work'
import type { GameAgent } from './orchestrator-game-state'
import { ticketInText } from './orchestrator-game-ticket-id'
import type { TeamTicket } from './team-panel-model-types'

/** A member's ticket: its tracker item, else an id in its name or branch, titled from the To Do. */
export const ticketOf = (
  agent: GameAgent,
  name: string,
  project: GameProjectWork | undefined
): TeamTicket | null => {
  const item = agent.workItem
  if (item) {
    return {
      identifier: item.identifier.toUpperCase(),
      title: item.title || null,
      url: item.url || null,
      statusGroup: item.statusGroup
    }
  }
  const identifier = ticketInText(name) ?? ticketInText(agent.worktree?.branch)
  if (!identifier) {
    return null
  }
  // Why: a member read from its name still has its title in the project's To Do.
  const todo = project?.todo?.items.find((one) => one.id.toUpperCase() === identifier)
  return {
    identifier,
    title: todo?.title || null,
    url: todo?.url || null,
    statusGroup: todo?.group ?? null
  }
}
