import {
  gameFleetMembersOf,
  gameFleetRowOf,
  ticketOfMember,
  type GameFleetInput,
  type GameFleetRow
} from './orchestrator-game-fleet-verbs'
import { remoteDispatchIdOf } from './orchestrator-game-auto-release'
import { foundHostPaneOf, type FoundHostPane } from './orchestrator-game-found-host-pane'
import type { GameAgent } from './orchestrator-game-state'
import { gameMemberKeyMatchesOf, gameRemoveKeyOf } from './orchestrator-game-remove-target'

export type GameStopTarget = {
  agent: GameAgent
  row: GameFleetRow
  worktreeId: string | null
  /** A remote member's home dispatch; its terminal handle only resolves on its host. */
  remoteDispatchId: string | null
  /** A session found on a paired host: only its pane there ends it (ORCA-1396). */
  hostPane: FoundHostPane | null
}

/** A key that names several members; stop refuses it and lists each one's own key (ORCA-1477). */
export type GameStopAmbiguous = {
  key: string
  matches: { name: string; key: string; host: string | null }[]
}

/**
 * Members `orca game stop` ends, in list order; never the lead, and a found session only by name.
 * A key names one member: its dispatch id or pane key, else the one member with that ticket or name.
 */
export function gameStopTargetsOf(
  state: GameFleetInput,
  keys: 'all' | readonly string[],
  workers: readonly { dispatchId: string; agentTerminalHandle: string | null }[] = []
): { targets: GameStopTarget[]; missing: string[]; ambiguous: GameStopAmbiguous[] } {
  const members = gameFleetMembersOf(state)
  const targetOf = (agent: GameAgent): GameStopTarget => ({
    agent,
    row: gameFleetRowOf(agent),
    worktreeId: agent.worktree?.id ?? null,
    remoteDispatchId: remoteDispatchIdOf(agent),
    hostPane: foundHostPaneOf(agent)
  })
  if (keys === 'all') {
    const all = members.map(targetOf)
    return { targets: all.filter((target) => !target.row.found), missing: [], ambiguous: [] }
  }
  const picked = new Set<GameAgent>()
  const missing: string[] = []
  const ambiguous: GameStopAmbiguous[] = []
  for (const key of new Set(keys.map((one) => one.trim()).filter(Boolean))) {
    const byKey = gameMemberKeyMatchesOf(members, key, workers)
    // Why the name: a found session may carry no ticket, and its worktree name is how the fleet lists it.
    const matches = byKey.length > 0 ? byKey : members.filter((agent) => isNamed(agent, key))
    if (matches.length === 1) {
      picked.add(matches[0])
    } else if (matches.length === 0) {
      missing.push(key)
    } else {
      ambiguous.push({
        key,
        matches: matches.map((agent) => ({
          name: agent.displayName ?? agent.paneKey,
          key: gameRemoveKeyOf(agent.paneKey),
          host: agent.remote?.host ?? null
        }))
      })
    }
  }
  return { targets: members.filter((agent) => picked.has(agent)).map(targetOf), missing, ambiguous }
}

const isNamed = (agent: GameAgent, key: string): boolean => {
  const wanted = key.toUpperCase()
  return (
    ticketOfMember(agent) === wanted ||
    (agent.displayName ?? agent.paneKey).toUpperCase() === wanted
  )
}
