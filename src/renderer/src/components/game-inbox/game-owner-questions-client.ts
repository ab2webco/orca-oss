import { parseExecutionHostId } from '../../../../shared/execution-host'
import {
  parseGameOwnerQuestion,
  type GameOwnerQuestion,
  type GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'

/** Whose board the Inbox reads: the runtime that owns the worktree, which keys it by project. */
export type GameInboxScope = { target: RuntimeClientTarget; worktreeId: string }

const GAME_INBOX_RPC_TIMEOUT_MS = 15_000

// Why: the local runtime runs SSH worktrees; only a paired host keeps its own board.
export function gameInboxTargetOf(hostId: string | null | undefined): RuntimeClientTarget {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'runtime'
    ? { kind: 'environment', environmentId: parsed.environmentId }
    : { kind: 'local' }
}

export async function readOpenGameOwnerQuestions(
  scope: GameInboxScope
): Promise<GameOwnerQuestion[]> {
  const result = await callRuntimeRpc<{ questions?: unknown }>(
    scope.target,
    'game.ownerQuestions',
    { worktreeId: scope.worktreeId },
    { timeoutMs: GAME_INBOX_RPC_TIMEOUT_MS }
  )
  // Why parse: a paired host may run another build.
  const questions = Array.isArray(result.questions) ? result.questions : []
  return questions.flatMap((raw) => parseGameOwnerQuestion(raw) ?? [])
}

export async function answerGameOwnerQuestion(
  scope: GameInboxScope,
  id: string,
  reply: GameOwnerReply
): Promise<void> {
  await callRuntimeRpc(
    scope.target,
    'game.ownerAnswer',
    { worktreeId: scope.worktreeId, id, ...reply },
    { timeoutMs: GAME_INBOX_RPC_TIMEOUT_MS }
  )
}
