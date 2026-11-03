/** `game.inboxThreads`' result as the desktop and the phone read it from any host build. */
import { z } from 'zod'
import type {
  GameAnsweredItem,
  GameInboxThread,
  GameInboxThreads,
  GameThreadMessage,
  GameWaitingItem
} from './orchestrator-game-inbox-threads'

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

export function parseGameInboxThreads(raw: unknown): GameInboxThreads {
  const result = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    threads: threadsOf(result.threads),
    waiting: itemsOf(result.waiting, Waiting),
    answered: itemsOf(result.answered, Answered)
  }
}
