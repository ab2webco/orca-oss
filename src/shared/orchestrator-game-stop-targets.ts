import {
  gameFleetMembersOf,
  gameFleetRowOf,
  type GameFleetInput,
  type GameFleetRow
} from './orchestrator-game-fleet-verbs'

export type GameStopTarget = {
  row: GameFleetRow
  worktreeId: string | null
  /** A remote member's home dispatch; its terminal handle only resolves on its host. */
  remoteDispatchId: string | null
}

/** Members `orca game stop` ends, in list order; never the lead, and a found session only by name. */
export function gameStopTargetsOf(
  state: GameFleetInput,
  tickets: 'all' | readonly string[]
): { targets: GameStopTarget[]; missing: string[] } {
  const all = gameFleetMembersOf(state).map((agent) => ({
    row: gameFleetRowOf(agent),
    worktreeId: agent.worktree?.id ?? null,
    remoteDispatchId: agent.remote ? agent.paneKey.replace(/^remote:/, '') : null
  }))
  if (tickets === 'all') {
    return { targets: all.filter((target) => !target.row.found), missing: [] }
  }
  const named = [...new Set(tickets.map((ticket) => ticket.trim().toUpperCase()))]
  // Why the name: a found session may carry no ticket, and its worktree name is how the fleet lists it.
  const isNamed = (row: GameFleetRow, name: string): boolean =>
    row.ticket === name || row.name.toUpperCase() === name
  return {
    targets: all.filter((target) => named.some((name) => isNamed(target.row, name))),
    missing: named.filter((name) => !all.some((target) => isNamed(target.row, name)))
  }
}
