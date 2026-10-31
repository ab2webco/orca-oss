import { STOPPABLE } from './orchestrator-game-stop'

type RebindTerminal = {
  handle: string
  worktreeId: string
  tabId: string
  leafId: string
  liveness: string
  connected: boolean
}

type RebindWorker = { dispatchId: string; agentTerminalHandle: string | null; workerState: string }

type RebindAgent = { paneKey: string; state: string }

export type RebindChoice = { handle: string } | { refusal: string; handles: string[] }

// Why: the start waits for the agent's prompt, and by then the old dispatch is already stopped.
const MID_TURN = new Set(['working', 'blocked'])

/**
 * The terminal a member now runs in after its own was replaced (CIN-1297): the one live agent
 * terminal in its worktree that no other live dispatch holds. Several, or none, is the lead's call.
 */
export function rebindTerminalOf(
  member: { dispatchId: string; terminalHandle: string | null; worktreeId: string },
  found: {
    terminals: readonly RebindTerminal[]
    workers: readonly RebindWorker[]
    agents: readonly RebindAgent[]
  }
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
  const agentStates = new Map(found.agents.map((agent) => [agent.paneKey, agent.state]))
  const candidates = live.flatMap((terminal) => {
    const state = agentStates.get(`${terminal.tabId}:${terminal.leafId}`)
    return state !== undefined && !held.has(terminal.handle)
      ? [{ handle: terminal.handle, state }]
      : []
  })
  const handles = candidates.map((candidate) => candidate.handle)
  if (candidates.length === 1) {
    return MID_TURN.has(candidates[0]!.state)
      ? { refusal: 'its agent is mid-turn; rebind it at its prompt', handles }
      : { handle: handles[0]! }
  }
  return handles.length === 0
    ? { refusal: 'no live agent terminal in its worktree', handles }
    : { refusal: 'several live agent terminals in its worktree', handles }
}
