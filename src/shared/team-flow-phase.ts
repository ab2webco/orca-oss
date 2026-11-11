import type { GameAgent } from './orchestrator-game-state'
import type { TeamFlowPhase } from './team-panel-model-types'

type PhaseInput = Pick<GameAgent, 'state' | 'toolName'> & {
  review?: { state: string } | null
  workItem?: { statusGroup?: string | null } | null
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const isTeamWorkFinished = (agent: PhaseInput): boolean =>
  agent.review?.state === 'merged' || agent.workItem?.statusGroup === 'done'

/** Where a member's ticket is in the cycle; null while it sits unfinished. */
export function teamFlowPhaseOf(agent: PhaseInput): TeamFlowPhase | null {
  const finished = isTeamWorkFinished(agent)
  if (!finished && agent.state !== 'working' && agent.state !== 'waiting') {
    return null
  }
  if (finished || agent.workItem?.statusGroup === 'review') {
    return 'merge'
  }
  if (agent.toolName !== null && EDIT_TOOLS.has(agent.toolName)) {
    return 'code'
  }
  return agent.review?.state === 'open' || agent.review?.state === 'draft' ? 'pr' : 'plan'
}
