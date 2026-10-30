import type { CommandHandler } from '../dispatch'
import type { RuntimeRpcSuccess } from '../../shared/runtime-rpc-envelope'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import { forgetGameMember } from './orchestrator-game-board-call'

type Client = Parameters<CommandHandler>[0]['client']

/**
 * Whether another member holds the ticket or the worktree, so a refused start's record is not its
 * own to drop. `saved` false reads only live agents: a later state lists this launch's record.
 */
export function gameTicketHeldOf(
  state: OrchestratorGameState,
  ticket: string,
  worktree: string,
  saved = true
): boolean {
  const worktreeId = worktree.startsWith('id:') ? worktree.slice('id:'.length) : null
  const records = saved
    ? [
        ...(state.pausedMembers ?? []),
        ...(state.queuedMembers ?? []),
        ...(state.unlistedMembers ?? [])
      ]
    : []
  return (
    records.some((one) => one.ticket.toUpperCase() === ticket) ||
    state.agents.some(
      (agent) =>
        ticketOfMember(agent) === ticket ||
        (worktreeId !== null && agent.worktree?.id === worktreeId)
    )
  )
}

/** Frees the `launching` record a refused start wrote, so the ticket never reads as paused (ORCA-894). */
export async function forgetRefusedLaunch(args: {
  client: Client
  /** The state the launch read before it wrote its record. */
  state: OrchestratorGameState
  ticket: string
  worktree: string
  reread: () => Promise<RuntimeRpcSuccess<OrchestratorGameState>>
}): Promise<void> {
  const { state, ticket, worktree } = args
  if (gameTicketHeldOf(state, ticket, worktree)) {
    return
  }
  // Why read again: a member that went live after `state` is what the host refused for; unreadable keeps the record.
  const now = await args.reread().then(
    (response) => response.result,
    () => null
  )
  if (now !== null && !gameTicketHeldOf(now, ticket, worktree, false)) {
    await forgetGameMember(args.client, ticket)
  }
}
