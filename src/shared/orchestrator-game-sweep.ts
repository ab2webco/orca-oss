import {
  gameFleetMembersOf,
  gameFleetRowOf,
  type GameFleetInput,
  type GameFleetRow
} from './orchestrator-game-fleet-verbs'
import { finishedSignalOf, isFinishedMember } from './orchestrator-game-member-finished'

/** What `orca game sweep` frees: members finished by their review or their home Run (ORCA-1397). */

export type GameSweepEntry = {
  row: GameFleetRow
  /** Why it counts as finished, with the live state that let it through. */
  reason: string
  pending: string[]
}

/** Finished members, each with what releasing its tab still leaves for someone to do. */
export function gameSweepOf(state: GameFleetInput): GameSweepEntry[] {
  return gameFleetMembersOf(state)
    .filter((agent) => !agent.found && isFinishedMember(agent))
    .map((agent) => {
      const pending: string[] = []
      if (agent.worktree) {
        pending.push(`worktree ${agent.worktree.branch} stays`)
      }
      if (!agent.workItem && !agent.remote?.ticketDone) {
        pending.push('no linked ticket to confirm')
      } else if (agent.workItem && agent.workItem.statusGroup !== 'done') {
        pending.push(
          `ticket ${agent.workItem.identifier} is ${agent.workItem.status || agent.workItem.statusGroup}, not done`
        )
      }
      if (!agent.terminalHandle) {
        pending.push('no terminal to close')
      }
      return {
        row: gameFleetRowOf(agent),
        reason: `${finishedSignalOf(agent)}; agent ${agent.state}`,
        pending
      }
    })
}
