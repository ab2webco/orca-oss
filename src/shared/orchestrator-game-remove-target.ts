import { remoteDispatchIdOf } from './orchestrator-game-auto-release'
import type { GameAgent } from './orchestrator-game-state'

/** The dispatch fields `orchestration.workerList` gives that tie a local dispatch to its pane. */
type DispatchOnTerminal = { dispatchId: string; agentTerminalHandle: string | null }

/**
 * The members `orca game remove <key>` names, matched in order: a remote member's dispatch id, a
 * local dispatch's terminal, a pane key (the card's), then an exact name. Why never a ticket or
 * worktree: a stale row and a new member can share both (ORCA-1473).
 */
export function gameRemoveMatchesOf(
  members: readonly GameAgent[],
  key: string,
  workers: readonly DispatchOnTerminal[]
): GameAgent[] {
  const wanted = key.trim()
  const remote = members.filter((agent) => remoteDispatchIdOf(agent) === wanted)
  if (remote.length > 0) {
    return remote
  }
  const handle = workers.find((worker) => worker.dispatchId === wanted)?.agentTerminalHandle
  const onTerminal = handle ? members.filter((agent) => agent.terminalHandle === handle) : []
  if (onTerminal.length > 0) {
    return onTerminal
  }
  const byPane = members.filter((agent) => agent.paneKey === wanted)
  return byPane.length > 0
    ? byPane
    : members.filter((agent) => (agent.displayName ?? agent.paneKey) === wanted)
}

/** What `game remove` takes to name exactly this member again: a remote member's dispatch id, else its pane key. */
export const gameRemoveKeyOf = (paneKey: string): string =>
  paneKey.startsWith('remote:') ? paneKey.slice('remote:'.length) : paneKey

/** The lead's turn the card's Remove sends. */
export function gameRemovePromptOf(card: { paneKey: string; name: string }): string {
  return `Remove the member ${card.name} with \`orca game remove ${gameRemoveKeyOf(card.paneKey)}\` and tell me only the result.`
}

/**
 * Whether a failed stop leaves the member running, so it must not be forgotten. Why not for a
 * remote member its host does not answer or that left its host: nothing proves it runs.
 */
export const gameRemoveStillRuns = (agent: Pick<GameAgent, 'remote'>): boolean =>
  !agent.remote || (agent.remote.stateKnown && !agent.remote.gone)
