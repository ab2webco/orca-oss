import { renderGameWorkPrompt } from '../../../../shared/orchestrator-game-actions'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamMemberCard, TeamTodoTicket } from '../../../../shared/team-panel-model-types'

/** The project's To Do tickets that no member holds, for the + menu's Add a member (ORCA-717). */
export function teamTodoTicketsOf(
  state: OrchestratorGameState,
  members: readonly TeamMemberCard[]
): TeamTodoTicket[] {
  const held = new Set(members.flatMap((one) => one.ticket?.identifier.toUpperCase() ?? []))
  return (state.project?.todo?.items ?? []).flatMap((item) =>
    item.group === 'todo' && !held.has(item.id.toUpperCase())
      ? [
          {
            identifier: item.id,
            title: item.title,
            // Why rendered here: an older host sends no prompt, and work-on would send the default.
            prompt: item.prompt ?? renderGameWorkPrompt(undefined, item)
          }
        ]
      : []
  )
}
