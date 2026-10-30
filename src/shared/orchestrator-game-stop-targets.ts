import { membersOf, rowOf, type GameFleetRow } from './orchestrator-game-fleet-verbs'
import type { OrchestratorGameState } from './orchestrator-game-state'

export type GameStopTarget = {
  row: GameFleetRow
  worktreeId: string | null
  /** A remote member's home dispatch; its terminal handle only resolves on its host. */
  remoteDispatchId: string | null
}

/** Members `orca game stop` ends, in list order; never the lead. */
export function gameStopTargetsOf(
  state: Pick<OrchestratorGameState, 'agents' | 'lead'>,
  tickets: 'all' | readonly string[]
): { targets: GameStopTarget[]; missing: string[] } {
  const all = membersOf(state).map((agent) => ({
    row: rowOf(agent),
    worktreeId: agent.worktree?.id ?? null,
    remoteDispatchId: agent.remote ? agent.paneKey.replace(/^remote:/, '') : null
  }))
  if (tickets === 'all') {
    return { targets: all, missing: [] }
  }
  const named = [...new Set(tickets.map((ticket) => ticket.trim().toUpperCase()))]
  return {
    targets: all.filter((target) => target.row.ticket && named.includes(target.row.ticket)),
    missing: named.filter((ticket) => !all.some((target) => target.row.ticket === ticket))
  }
}
