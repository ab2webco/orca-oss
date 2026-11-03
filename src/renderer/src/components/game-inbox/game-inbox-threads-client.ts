import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import { parseGameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads-parse'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { GameInboxScope } from './game-owner-questions-client'

const GAME_INBOX_THREADS_RPC_TIMEOUT_MS = 15_000

export async function readGameInboxThreads(scope: GameInboxScope): Promise<GameInboxThreads> {
  const result = await callRuntimeRpc<unknown>(
    scope.target,
    'game.inboxThreads',
    { worktreeId: scope.worktreeId },
    { timeoutMs: GAME_INBOX_THREADS_RPC_TIMEOUT_MS }
  )
  return parseGameInboxThreads(result)
}

export type GameMemberReply = { id: string; text: string; ticket?: string }

/** The person's words for a member's question or gate, sent through the lead's run; throws why it failed. */
export async function replyToGameMember(
  scope: GameInboxScope,
  reply: GameMemberReply
): Promise<{ mode: string; delivered: boolean }> {
  const result = await callRuntimeRpc<{ mode?: unknown; delivered?: unknown }>(
    scope.target,
    'game.ownerReplyToMember',
    { worktreeId: scope.worktreeId, ...reply },
    { timeoutMs: GAME_INBOX_THREADS_RPC_TIMEOUT_MS }
  )
  return {
    mode: typeof result.mode === 'string' ? result.mode : 'reply',
    delivered: result.delivered === true
  }
}
