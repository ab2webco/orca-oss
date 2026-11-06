import type { GameAction } from './orchestrator-game-actions'
import type { GameProjectList } from './orchestrator-game-project-work'

export type TeamLeadAction = { id: string; label: string; prompt: string }

// Why prompts only: an MCP action runs through the mod's `$.mcp`, which has no native path yet.
function promptActionOf(action: GameAction): TeamLeadAction | null {
  return 'prompt' in action ? { id: action.id, label: action.label, prompt: action.prompt } : null
}

/** The action a list says its link runs; null keeps the link, so the list is never out of reach. */
export function teamListActionOf(
  list: Pick<GameProjectList, 'actionId'>,
  actions: readonly GameAction[]
): TeamLeadAction | null {
  const named = actions.find((one) => one.id === list.actionId)
  return named ? promptActionOf(named) : null
}
