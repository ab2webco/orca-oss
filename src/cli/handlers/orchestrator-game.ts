import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'

function formatGameState(state: OrchestratorGameState): string {
  const lines = [
    `Game: ${state.config.mode} (scene ${state.config.scene}, mode from ${state.sources.mode})`,
    `Agents: ${state.agents.length}`
  ]
  if (state.review) {
    lines.push(
      `Review: ${state.review.provider} #${state.review.number} ${state.review.state}, CI ${state.review.ci}`
    )
  }
  if (state.workItem) {
    lines.push(
      `Work item: ${state.workItem.identifier} ${state.workItem.status || state.workItem.statusGroup}`
    )
  }
  return [...lines, ...state.warnings.map((warning) => `Warning: ${warning}`)].join('\n')
}

export const ORCHESTRATOR_GAME_HANDLERS: Record<string, CommandHandler> = {
  'game state': async ({ client, json }) => {
    // Why: the game mod runs inside the Agent Teams pane, so the pane's own env names its worktree.
    const result = await client.call<OrchestratorGameState>('game.state', {
      worktreeId: process.env.ORCA_WORKTREE_ID,
      terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
      paneKey: process.env.ORCA_PANE_KEY
    })
    printResult(result, json, formatGameState)
  }
}
