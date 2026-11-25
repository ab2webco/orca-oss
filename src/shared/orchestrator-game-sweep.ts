import {
  gameFleetMembersOf,
  gameFleetRowOf,
  type GameFleetInput,
  type GameFleetRow
} from './orchestrator-game-fleet-verbs'
import { finishedSignalOf, isFinishedMember } from './orchestrator-game-member-finished'
import { isLeftoverMember } from './orchestrator-game-member-leftover'
import { foundHostPaneOf, type FoundHostPane } from './orchestrator-game-found-host-pane'
import type { GameAgent } from './orchestrator-game-state'

/** What `orca game sweep` frees: members finished by their review or their home Run (ORCA-1397). */

export type GameSweepEntry = {
  row: GameFleetRow
  /** Why it counts as finished, with the live state that let it through. */
  reason: string
  pending: string[]
  /** A leftover found on a paired host: --close closes its pane there (ORCA-1424). */
  foundOnHost?: FoundHostPane
}

/** A found session on a paired host that answers, with no live agent: no lead will end it. */
function sweptLeftoverOf(agent: GameAgent): FoundHostPane | null {
  const found = foundHostPaneOf(agent)
  return found && agent.remote?.stateKnown !== false && isLeftoverMember(agent) ? found : null
}

/** Finished members and leftovers on paired hosts, each with what freeing it still leaves to do. */
export function gameSweepOf(state: GameFleetInput): GameSweepEntry[] {
  const members = gameFleetMembersOf(state)
  const leftovers = members.flatMap((agent): GameSweepEntry[] => {
    const found = sweptLeftoverOf(agent)
    if (!found) {
      return []
    }
    const reason = `leftover on ${found.host}: no lead runs it; agent ${agent.state}`
    const pending = agent.worktree ? [`worktree ${agent.worktree.branch} stays`] : []
    return [{ row: gameFleetRowOf(agent), reason, pending, foundOnHost: found }]
  })
  const finished = members
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
  return [...finished, ...leftovers]
}
