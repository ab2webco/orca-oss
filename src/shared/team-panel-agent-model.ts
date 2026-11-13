import type { GameAgent } from './orchestrator-game-state'
import type { TeamModel } from './team-panel-model-types'

/** The model a card names: what Jev has the agent on, else its launch choice, else `fallback`. */
export const teamAgentModelOf = (
  agent: GameAgent,
  fallback?: { model?: string; effort?: string }
): TeamModel | null => {
  if (agent.advisor?.model) {
    return { label: agent.advisor.model, effort: agent.advisor.effort, source: 'advisor' }
  }
  if (agent.launch?.model) {
    return {
      label: agent.launch.model,
      effort: agent.launch.effort,
      source: agent.launch.source ?? 'launch'
    }
  }
  return fallback?.model
    ? { label: fallback.model, effort: fallback.effort ?? null, source: 'launch' }
    : null
}
