import {
  parseGameArcadeCredits,
  type GameArcadeCredits
} from '../../../../shared/orchestrator-game-arcade-credits'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { GameInboxScope } from '../game-inbox/game-owner-questions-client'

const GAME_ARCADE_RPC_TIMEOUT_MS = 15_000

// Why: a host older than game.arcade keeps no credits; that reads as none, never as an error.
const isOldHost = (error: unknown): boolean =>
  error instanceof RuntimeRpcCallError && error.code === 'method_not_found'

/** The project's saved plays on the host that owns the worktree; null for a member or an older host. */
export async function readGameArcadeCredits(
  scope: GameInboxScope
): Promise<GameArcadeCredits | null> {
  try {
    const result = await callRuntimeRpc<{ arcade?: unknown }>(
      scope.target,
      'game.arcade',
      { worktreeId: scope.worktreeId },
      { timeoutMs: GAME_ARCADE_RPC_TIMEOUT_MS }
    )
    return result.arcade ? parseGameArcadeCredits(result.arcade) : null
  } catch (error) {
    if (isOldHost(error)) {
      return null
    }
    throw error
  }
}

/** Spends one saved play, then opens the Arcade tab; false when none was left. */
export async function playSavedArcadeRun(
  scope: GameInboxScope,
  openTab: (worktreeId: string) => void
): Promise<boolean> {
  const result = await callRuntimeRpc<{ ok?: unknown }>(
    scope.target,
    'game.arcade',
    { worktreeId: scope.worktreeId, action: 'play' },
    { timeoutMs: GAME_ARCADE_RPC_TIMEOUT_MS }
  )
  if (result.ok !== true) {
    return false
  }
  openTab(scope.worktreeId)
  return true
}
