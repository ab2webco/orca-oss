import { z } from 'zod'
import type {
  GameAnsweredItem,
  GameInboxThread,
  GameInboxThreads,
  GameThreadMessage,
  GameWaitingItem
} from '../../../../shared/orchestrator-game-inbox-threads'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { GameInboxScope } from './game-owner-questions-client'

const GAME_INBOX_THREADS_RPC_TIMEOUT_MS = 15_000

const Kind = z.enum(['question', 'decision_gate'])

const Message: z.ZodType<GameThreadMessage> = z.object({
  id: z.string(),
  at: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  subject: z.string(),
  body: z.string(),
  failure: z
    .object({ kind: z.enum(['rejected', 'failed']), reason: z.string().nullable() })
    .nullable()
})

const Waiting: z.ZodType<GameWaitingItem> = z.object({
  id: z.string(),
  ticket: z.string(),
  kind: Kind,
  subject: z.string(),
  body: z.string(),
  at: z.string(),
  answerer: z.string()
})

const Answered: z.ZodType<GameAnsweredItem> = z.object({
  id: z.string(),
  ticket: z.string(),
  kind: Kind,
  question: z.string(),
  answer: z.string(),
  askedAt: z.string(),
  answeredAt: z.string(),
  overriddenBy: z.object({ text: z.string(), at: z.string() }).optional()
})

// Why per item: a paired host may run another build; one odd row must not blank the Inbox.
function itemsOf<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  return Array.isArray(raw)
    ? raw.flatMap((item) => {
        const parsed = schema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
    : []
}

const ThreadHead = z.object({ ticket: z.string(), last: z.string(), waiting: z.number() })

function threadsOf(raw: unknown): GameInboxThread[] {
  return Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        const head = ThreadHead.safeParse(item)
        if (!head.success) {
          return []
        }
        const messages = (item as { messages?: unknown }).messages
        return [{ ...head.data, messages: itemsOf(messages, Message) }]
      })
    : []
}

export async function readGameInboxThreads(scope: GameInboxScope): Promise<GameInboxThreads> {
  const result = await callRuntimeRpc<Record<string, unknown>>(
    scope.target,
    'game.inboxThreads',
    { worktreeId: scope.worktreeId },
    { timeoutMs: GAME_INBOX_THREADS_RPC_TIMEOUT_MS }
  )
  return {
    threads: threadsOf(result.threads),
    waiting: itemsOf(result.waiting, Waiting),
    answered: itemsOf(result.answered, Answered)
  }
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
