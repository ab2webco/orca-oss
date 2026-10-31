import { STOPPABLE } from './orchestrator-game-stop'

type RebindTerminal = {
  handle: string
  worktreeId: string
  liveness: string
  connected: boolean
}

type RebindWorker = { dispatchId: string; agentTerminalHandle: string | null; workerState: string }

export type RebindChoice = { handle: string } | { refusal: string; handles: string[] }

/**
 * The terminal a member now runs in after its own was replaced (CIN-1297): the one live terminal
 * in its worktree that no other live dispatch holds. Several, or none, is the lead's call.
 */
export function rebindTerminalOf(
  member: { dispatchId: string; terminalHandle: string | null; worktreeId: string },
  found: { terminals: readonly RebindTerminal[]; workers: readonly RebindWorker[] }
): RebindChoice {
  const live = found.terminals.filter(
    (terminal) =>
      terminal.worktreeId === member.worktreeId &&
      terminal.connected &&
      terminal.liveness === 'running'
  )
  if (live.some((terminal) => terminal.handle === member.terminalHandle)) {
    return { refusal: 'own terminal still runs', handles: [] }
  }
  const held = new Set(
    found.workers.flatMap((worker) =>
      worker.dispatchId !== member.dispatchId &&
      worker.agentTerminalHandle &&
      STOPPABLE.has(worker.workerState)
        ? [worker.agentTerminalHandle]
        : []
    )
  )
  const handles = live.map((terminal) => terminal.handle).filter((handle) => !held.has(handle))
  if (handles.length === 1) {
    return { handle: handles[0]! }
  }
  return handles.length === 0
    ? { refusal: 'no live terminal in its worktree', handles }
    : { refusal: 'several live terminals in its worktree', handles }
}
